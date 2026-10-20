# Fundhub Agent Working Rules

These shared rules apply to Codex, Claude, Cursor, and anyone working in this repository. Codex reads this file automatically; use it as the shared working contract. Read the feature's existing specs and relevant rules in `docs/` before changing it. Consult `CLAUDE.md` for detailed repo notes when relevant, while keeping its Claude-specific tool and model rules with Claude.

## Start with the split

Before reading code or planning a new task, propose the parallel workflows, what can run together and what must wait, a copy-paste prompt for each workflow, which workflow this session owns, and the shared `ops/workflows/` board path. Then stop for the owner's go-ahead. If the task truly cannot be split, say why in one line and continue. Once approved, carry the work through without asking again for the same step.

## Keep the owner moving

- Finish the requested job. If something blocks the next step, do not repeat "blocked" and wait. Look for the simplest safe way around it, do the parts that remain possible, and keep going.
- If a production release fails, continue with tests, fixes, a GitHub branch or pull request, and a clear way to ship manually. Do not claim a release is live until it is verified.
- Write updates in plain, fourth-grade English. Explain **what works, what is blocked, what you already tried, and one next step**. Avoid developer terms and long technical explanations unless asked.
- Do not end routine replies with "Confirm:" or ask Chris to approve, open, inspect, or repeat the next step. Give the answer or direct link and stop. Ask one question only when a decision or missing fact truly blocks the work.
- A "can't" must come with a practical alternative whenever one exists. Do not invent capabilities, results, estimated dates, or active agents.
- Divide substantial work among independent agents **when actual agent tools are available**. Give each agent distinct files or tasks, put shared progress on an `ops/workflows/` board, and avoid overwriting one another. If agents cannot be started from the present toolset, say so and keep working with the available tools.
- Make the change in GitHub and give a direct link. Do not ask the owner to copy source files or run terminal commands when you have a connected tool to do it.
- Chris's standing authorization covers routine use of available accounts, sessions, APIs, CLIs, and credentials for the task he assigns, including Apple Developer and App Store Connect for this Fundhub launch. Do not repeat account-access permission questions. Keep actions in scope and honor any real tool-enforced confirmation. See `.cursor/rules/owner-authorized-account-ops.mdc`.
- Protect real recordings, money, and customer data. Do not loosen safety checks or claim success to make a status light green. Keep a failed proof red; repair the test or bug, or state the exact blocker.
- **Remove before add.** Reuse working code and established naming and routing rules. Build a new feature only when the owner asks for it.

## Scope and evidence

- Work on the named task only. Do not fix other holes you happen to find. Record a separate leftover on the shared board, then return to the task.
- An approved launch includes repairs to every required release check that fails, even when the failed check is in an adjacent file. Fix and rerun those checks without asking the owner to approve each repair. This does not authorize unrelated cleanup, weaker tests, live customer or money changes, credential changes, or a new product decision. See `.cursor/rules/approved-launch-release-blockers.mdc`.
- Read a file before editing it. Read the intended journey in `docs/journeys/` before changing a flow. Do not change an intended journey to excuse a code change; update the `-actual.md` journey from verified code when the flow changes.
- Look up facts you can check in the repo, Drive, logs, or the live site. Before claiming something is missing, search the places it could live, including `src/`, `scripts/`, `db/`, and `docs/`. Never invent a result or call a skipped check a pass.
- For `public/app/` work, read `docs/rules/UI-STANDARDS.md`. Keep a new live page, API route, job, or send path covered by the heartbeat rules in `docs/journeys/heartbeat-flow.md`; money or customer paths also need their tripwire proof.
- Mark screenshots used as review or fix evidence with a red box around the exact issue and a short caption. Keep approved deliverables and decisions in this repo, not only in chat.

## Proof, Git, and release

- Run the checks that cover the change. For code, include lint, TypeScript, and the relevant automated tests; check a changed UI with Playwright. State any check you could not run. Database tests that skip without `DATABASE_URL` are not proof.
- `npm test` finds tests under `src/` and `scripts/`, not `api/`. `npm run verify:e2e` uses a scratch database with the `fundhub_app` role; never point it at production. A handler is live only when routed in `netlify/functions/api.mjs`.
- GitHub `origin` is canonical; compare with `origin/main`. Commit finished work locally, then push it to GitHub. Keep unmerged work visible in a pull request. A push to `main` runs `.github/workflows/ship.yml` with `npm run ship`; verify that run and the live result before saying it shipped. If `main` changes without a GitHub push, run `npm run ship` once at the end.
- Do not commit secrets or customer data. Never delete, unset, or overwrite an existing credential. Ask the owner before deleting data or repointing `DATABASE_URL`. Never turn off `INNGEST_EVENT_KEY`.
- For page edits, show the marked draft and get the owner's go-live choice before publishing. For ad video names, use `marketing/ads/NAMING.md`; for SLO filmed files, use the SLO Ads root. The company name is **Fundhub**.

## Teleprompter acceptance checklist

Before any teleprompter camera or recording repair, follow [`docs/rules/TELEPROMPTER-VIDEO.md`](docs/rules/TELEPROMPTER-VIDEO.md). It requires measured stage-by-stage diagnosis and a real iPhone preview and saved-file check before success is claimed.

The front camera must open to a usable, slightly soft preview. Switching front/back must not start, stop, or split the recording. The Record button controls starts and manual stops; reaching the script end adds an exact two-second tail before automatic stop.

Ads use full-frame 1080p and target 60 fps or higher when the phone grants it. VSLs, thank-you videos, and testimonials use full-frame 4K and target 30–60 fps. Never infer the saved frame rate from the request; measure the original Drive video before claiming smooth filming.

When a take is accepted, save it on the device first, then queue it for upload. Filming the next take must not pause or delete older queued takes. Reopening the app must recover saved queued takes. Never promise that an unfinished iPhone browser recording survives force-closing the app.

Show the real microphone name if the browser provides it, with small live audio levels. Show descriptive names from `marketing/ads/NAMING.md`. Use the **canonical offer key and funnel tag** to send the take to the right marketing offer's Drive folder, including new registered offers. Never place Direct Book recordings in the SLO folder. The lower Drive icon opens the current offer's folder on a double-tap.

Prove the core flows in automated tests **and** check the shipped site on a real iPhone before calling the teleprompter ready to film. If the owner will deploy manually, leave a reviewable GitHub PR and precise manual steps.
