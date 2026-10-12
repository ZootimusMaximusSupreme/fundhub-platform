# FundHub Agent Working Rules

These rules apply to Codex, Claude, Cursor, and anyone working in this repository. Also read `CLAUDE.md` and the feature's existing specs.

## Keep the owner moving

- Finish the requested job. If something blocks the next step, do not repeat "blocked" and wait. Look for the simplest safe way around it, do the parts that remain possible, and keep going.
- If a production release fails, continue with tests, fixes, a GitHub branch or pull request, and a clear way to ship manually. Do not claim a release is live until it is verified.
- Write updates in plain, fifth-grade English. Explain **what works, what is blocked, what you already tried, and one next step**. Avoid developer terms and long technical explanations unless asked.
- A "can't" must come with a practical alternative whenever one exists. Do not invent capabilities, results, estimated dates, or active agents.
- Divide substantial work among independent agents **when actual agent tools are available**. Give each agent distinct files or tasks, put shared progress on an `ops/workflows/` board, and avoid overwriting one another. If agents cannot be started from the present toolset, say so and keep working with the available tools.
- Make the change in GitHub and give a direct link. Do not ask the owner to copy source files or run terminal commands when you have a connected tool to do it.
- Protect real recordings, money, and customer data. Do not loosen safety checks or claim success to make a status light green. Keep a failed proof red; repair the test or bug, or state the exact blocker.
- **Remove before add.** Reuse working code and established naming and routing rules. Build a new feature only when the owner asks for it.

## Teleprompter acceptance checklist

The front camera must open to a usable, slightly soft preview. Switching front/back must not start, stop, or split the recording. The Record button controls starts and manual stops; reaching the script end adds an exact two-second tail before automatic stop.

When a take is accepted, save it on the device first, then queue it for upload. Filming the next take must not pause or delete older queued takes. Reopening the app must recover saved queued takes. Never promise that an unfinished iPhone browser recording survives force-closing the app.

Show the real microphone name if the browser provides it, with small live audio levels. Show descriptive names from `marketing/ads/NAMING.md`. Use the **canonical offer key and funnel tag** to send the take to the right marketing offer's Drive folder, including new registered offers. Never place Direct Book recordings in the SLO folder. The lower Drive icon opens the current offer's folder on a double-tap.

Prove the core flows in automated tests **and** check the shipped site on a real iPhone before calling the teleprompter ready to film. If the owner will deploy manually, leave a reviewable GitHub PR and precise manual steps.
