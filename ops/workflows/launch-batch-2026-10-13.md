# Launch batch — 2026-10-13

**PAUSED by Chris, 2026-10-13 7:56 p.m.** Nothing in this batch has started. Do not claim a row until he says go.

Chris got the Apple developer account on 2026-10-13. He asked to launch four things:

1. The teleprompter iPhone app
2. The CRM for the team
3. The customer portal (and check what the Apple account lets us do with it)
4. Finance OS

Four workflows. No dependencies between them, so all four can run at once.
One shared resource: the Apple developer account. **W1 owns it.** No other workflow
creates apps, bundle ids, keys or certificates in App Store Connect.

## Task list

| # | Workflow | Owner | Status | Model |
|---|---|---|---|---|
| W1 | Teleprompter iPhone app on Chris's phone through TestFlight | this session (Claude, branch `claude/teleprompter-ios-app`) | paused | Opus |
| W2 | CRM for the team, working on a phone | open | paused | Sonnet |
| W3 | Customer portal launch + what the Apple account can do for it | open | paused | Opus |
| W4 | Finance OS launch, Fundhub as client #1 | open | paused | Opus |

Status words: `pending` / `claimed` / `done` / `blocked`. Claim your row before you start.

## Owner steps (only Chris can do these)

- **W1:** make one App Store Connect API key with **App Manager** access. Send the Issuer ID, the Key ID and the `.p8` file (it downloads only once).
  https://appstoreconnect.apple.com/access/integrations/api
- Answer the one-at-a-time workflow questions each workflow asks before it builds (CLAUDE.md §3a).

## Shared brief (measured 2026-10-13)

- **Teleprompter app:** the Swift app already exists at `tools/teleprompter-ios/` (bundle id `ai.fundhub.prompter`, no team set, iOS 17+, XCTest tests in `FundhubPrompterTests/`). It already asks the front camera for 60 fps and saves the front camera mirrored. Build spec: `docs/specs/teleprompter-ios-app-build-2026-10-10.md`. The web teleprompter law from 2026-10-13 (`.claude/rules/teleprompter-camera.md`, in PR #44) replaces spec row 7: editing is copy and paste only. The 60 fps cap is a Safari limit, so the app may use 60 fps.
- **Web teleprompter:** locked by owner law. No workflow changes `public/app/teleprompter*`.
- **CRM:** staff screens live in `public/app/` (`pipeline.html`, `closer-dashboard.html`, `sales-floor.html`, `csm-queue.html`, `messaging.html`, `calendar.html`, `staff-teams.html`, and more). Open owner to-do (PR #40): "Make the CRM mobile friendly — every CRM screen works on the phone." UI law: `docs/rules/UI-STANDARDS.md`.
- **Customer portal:** `public/app/client-portal.html` already links `public/manifest.webmanifest` (it can be added to the iPhone home screen). Open bugs in `TODO.md`: the Payments tab always says "No payments yet" and the Messages tab always says "No messages yet" for a client. A paying client has waited more than 72 hours to sign in.
- **Finance OS:** owner direction `docs/finance/finance-os-direction-2026-10-06.md` (wins over the older spec). It tracks and reminds, and never moves money. Fundhub is client #1. Each business and each person is a container. Screens: `public/app/finance-os.html`, `public/app/financeos.html`, `public/app/money-*.html`. Older notes: `docs/finance/FINANCE-OS-REBUILD-HANDOVER.md`, `docs/finance/client-finance-os-build-spec-2026-09-19.md`.
- **CI right now:** `screens (real browser)` is red on `main` from `e2e/morning-brief.spec.mjs` (Codex PR #41 owns that). Do not touch morning-brief files.

## Copy-paste prompts

### W1 — Teleprompter iPhone app (this session owns it)

```
Repo: ZootimusMaximusSupreme/fundhub-platform. Read CLAUDE.md, AGENTS.md and the board
ops/workflows/launch-batch-2026-10-13.md first. You are W1 of a split Chris approved; skip the §0 split.
Claim W1 on the board before you start.

Goal: the teleprompter iPhone app (tools/teleprompter-ios/) on Chris's iPhone 17 Pro Max through
TestFlight, filming at 60 fps, following the web teleprompter's 2026-10-13 law except the 30 fps cap.

1. Ship pipeline first. A GitHub Actions workflow on a macOS runner that builds the app and runs its
   XCTest tests on every change under tools/teleprompter-ios/, and uploads a build to TestFlight from
   main. Signing and upload use an App Store Connect API key stored as Actions secrets (Chris makes
   the key; you store it). Prove the build and tests pass on the runner before step 2 is called done.
2. Camera: Ads 1080p at 60 fps, VSLs, thank-you videos and testimonials 4K at 60 fps. Front camera saved
   mirrored, back camera saved as is. A flip during a take stays one file and never shows black.
   Keep both cameras ready for an instant flip when the phone supports it.
3. Same rules as the web page: speed 130 to 320 with the volume-button ladder
   (.claude/rules/teleprompter-speed.md), copy and paste only editing, no History, no "Choose words",
   "iPhone mic on" / "Rode on" with a Rode switch that waits for Stop.
4. Every take goes to the same Drive folder the web page uses, through POST/PUT
   /api/marketing/shoot/take, with the same "recording diagnostics v1" JSON, so Claude can check the
   frame rate from Drive.
Each rule gets an XCTest test that fails without it. Never change public/app/teleprompter*.
Write the manifest on the board when done. Talk to Chris at a 4th grade level.
```

### W2 — CRM for the team

```
Repo: ZootimusMaximusSupreme/fundhub-platform. Read CLAUDE.md, AGENTS.md, docs/rules/UI-STANDARDS.md
and the board ops/workflows/launch-batch-2026-10-13.md first. You are W2 of a split Chris approved;
skip the §0 split. Claim W2 on the board before you start.

Goal: launch the CRM for the Fundhub team, so a closer, a setter, a CSM and Chris can do their whole
day from a phone.
1. List every staff CRM screen in public/app/ and which role uses it. Open each at 390 px wide with a
   real browser (Playwright) and write what breaks, with marked-up screenshots (CLAUDE.md §8).
2. Ask Chris one question at a time until you know which screens and roles "launch" covers and who
   gets a login first. Do not guess the list.
3. Fix the screens he names so they work on a phone. Each fix gets a Playwright test at 390 px that
   fails without it. Heartbeat rows for anything new (.claude/rules/heartbeat-on-every-build.md).
Do not touch public/app/teleprompter*, morning-brief files, the customer portal or Finance OS screens.
Do not touch App Store Connect. Write the manifest on the board when done. 4th grade English for Chris.
```

### W3 — Customer portal launch + Apple account check

```
Repo: ZootimusMaximusSupreme/fundhub-platform. Read CLAUDE.md, AGENTS.md, docs/rules/UI-STANDARDS.md
and the board ops/workflows/launch-batch-2026-10-13.md first. You are W3 of a split Chris approved;
skip the §0 split. Claim W3 on the board before you start.

Goal: a paying client can sign in to the customer portal on their phone and see their deliverables,
payments and messages.
1. Apple check, research only. Read Apple's current App Review Guidelines and developer enrollment pages
   and answer with links: can the portal go in the App Store under Chris's developer account? Cover
   whether the account is an individual or an organization, the rule on apps in financial services, and
   the rule on apps that only wrap a website. Compare that with "Add to Home Screen" (the portal already
   links public/manifest.webmanifest). Do not create anything in App Store Connect; W1 owns that account.
2. Walk the portal as a real client at 390 px (Playwright on the live site with a test client). List what
   breaks. The known bugs: the Payments tab always says "No payments yet" and the Messages tab always says
   "No messages yet" for a client (TODO.md), and a paying client waited more than 72 hours to sign in.
3. Ask Chris one question at a time which breaks block launch, then fix those. Each fix gets a test that
   fails without it. The portal touches paying customers, so each fix also needs a tripwire
   (.claude/rules/heartbeat-on-every-build.md).
Do not touch public/app/teleprompter*, morning-brief files, the CRM screens or Finance OS screens.
Write the manifest on the board when done. 4th grade English for Chris.
```

### W4 — Finance OS

```
Repo: ZootimusMaximusSupreme/fundhub-platform. Read CLAUDE.md, AGENTS.md and the board
ops/workflows/launch-batch-2026-10-13.md first. You are W4 of a split Chris approved; skip the §0 split.
Claim W4 on the board before you start.

Goal: launch Finance OS with Fundhub as client #1. Owner direction: docs/finance/finance-os-direction-2026-10-06.md
(it wins over older finance docs). Finance OS tracks and reminds. It never moves money.
1. Measure what is built: the tables and routes behind containers, accounts, repeating bills, due dates
   and reminders, and the screens public/app/finance-os.html, financeos.html and money-*.html. Write a
   built / half-built / missing table on the board.
2. Ask Chris one question at a time (CLAUDE.md §3a) until you know what "launched" means for Fundhub as
   client #1: which accounts go in first, which reminders, by text or email, and the price per container
   (still unset).
3. Build in CLAUDE.md §3a order: schema, then a read route with a test on a real DATABASE_URL, then a
   one-page flow in docs/journeys/, then the screen. Money and paying-customer paths get a tripwire
   (.claude/rules/heartbeat-on-every-build.md). Reminders to Chris obey .claude/rules/texting-hours.md.
Do not touch public/app/teleprompter*, morning-brief files, the CRM screens or the customer portal.
Write the manifest on the board when done. 4th grade English for Chris.
```

## Manifests

(Each workflow writes here when done: files touched, routes, journeys, tests, proof.)

## Blockers and open questions

- W1: waiting on the App Store Connect API key from Chris.
