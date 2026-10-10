# Fundhub Prompter iPhone app — build spec (owner-set 2026-10-10)

**Status: paused.** Chris: the web teleprompter works fine for now. When the app goes out he
pays the $99 Apple developer account and this gets built. Nothing here is started.

## Why the app is needed

One thing the web page cannot do on an iPhone: the **volume buttons**. Apple does not let a web
page hear them, even when the page is saved to the home screen. The buttons change the phone
volume and the page never knows. Only a real app can catch them.

The app already exists at `tools/teleprompter-ios/` (Swift, SwiftUI). It already catches the
volume buttons and hides the volume pop-up (`FundhubPrompter/Core/VolumeWpm.swift`). It is a
separate app from the web page, so it has none of the changes made on 2026-10-09 and 2026-10-10.

## What to build — bring the app level with the web page

Each line is a rule Chris set on the web teleprompter. The web code is the reference.

| # | Rule | Web reference (`public/app/teleprompter.js`) |
|---|---|---|
| 1 | **Speed is held to 130 to 220 words a minute.** 130 is super slow, 220 is the top. Nothing goes outside. | `MIN_WPM`, `MAX_WPM`, `storedWpm` |
| 2 | **Volume buttons run it with no finger on the glass.** One ladder, 5 words a minute per press: back 220 … back 130 · paused · forward 130 … forward 220. Down while rolling slows it; at 130 one more press pauses; down again rolls back at 130; down again rolls back faster, up to 220, and stays. Up walks the other way: slower roll back, pause, roll forward, up to 220. Rolling back stops by itself at the first word. | `volumeLadder`, `volumeStep` |
| 3 | **One fixed scroll speed.** Script height in pixels divided by (words ÷ words a minute × 60). Blank gaps and paragraph breaks never speed it up. | `steadyPace` |
| 4 | **The script starts four lines down the screen**, not at the top. Never past the middle of a short screen. | `START_LINES_DOWN`, `readingLineTop` |
| 5 | **Sideways words are 0.6 of the set size.** Only on a phone that is really turned. | `SIDEWAYS_FONT`, `isLandscape` |
| 6 | **One tap is play and pause only.** No cursor, no keyboard. | `gestureStep`, `dropFocus` |
| 7 | **Two taps edit, in any mode.** The words pause, the cursor lands there, Save shows. Save puts the keyboard away. | `act` (`caret`), `saveScript` |
| 8 | **Every word change saves off the phone right away**, to the database, then the repo. | `createSaveQueue` (300 ms), `POST marketing/scripts/edit` |
| 9 | **Sideways, the controls are one slim row** so the words keep the room. | `teleprompter.css`, the `max-height: 520px` block |
| 10 | **The dark glass over the camera is 62% black.** | `#cam-shade` in `teleprompter.css` |
| 11 | **A phone never turns the words on its own.** Words turn only when the phone turns. | `turnFor` |

In the app, rule 2 hangs on `VolumeButtonWatch.onStep` (it already gives +1 or −1 per press).
Today that step only changes the speed. It has to walk the ladder instead.

## Done when

1. Each rule above has a test in `tools/teleprompter-ios/FundhubPrompterTests/` that fails
   without it.
2. On Chris's own iPhone: volume down from 140 goes 135, 130, pause, back at 130; volume up
   comes back the same way. The phone's volume pop-up does not show.
3. A word changed in the app shows up as a new version of that script on the server.

## Owner steps (only Chris can do these)

1. Pay for the Apple developer account ($99 a year). Without it the app has to be put back on
   the phone by cable every 7 days.
2. Plug the phone in once, or accept the TestFlight invite.

## Open decisions

- Whether volume up while paused should start the words (the web page does this), or only
  raise the speed.
- The sideways font number. 0.6 is the web value; Chris said he may tune it after testing.
