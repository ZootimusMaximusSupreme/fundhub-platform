# Fundhub Agent Working Rules

These shared rules apply to Codex, Claude, Cursor, and anyone working in this repository. Codex reads this file automatically; use it as the shared working contract. Read `docs/rules/RULES-INDEX.md` for every rule. Consult `CLAUDE.md` for numbered sections 0 to 12. Keep Claude-specific tool and model rules with Claude.

## Start with the split

Before reading code or planning a new task, state the parallel workflows, what can run together and what must wait, which workflow this session owns, and the shared `ops/workflows/` board path. Put self-contained copy-paste prompts on that board, start available agents, and proceed immediately. **Owner rule, 2026-10-19: split, then do; never stop for approval of the split.** If the task truly cannot be split, say why in one line and continue. Exception: if Chris said Full End-To-End Audit (or full e2e), skip the split this turn and follow `.ai/rules/full-end-to-end-audit.md` (two gate questions, then stop). Ask only when a missing owner decision genuinely blocks safe, in-scope work; a workflow split is not such a decision. A continuation or context summary does not reset approval.

## Keep the owner moving

- Finish the requested job. If something blocks the next step, do not repeat "blocked" and wait. Look for the simplest safe way around it, do the parts that remain possible, and keep going. A rule that blocks the obvious fix: find the best move that keeps the rule and say what you did. A policy or permission block (a 403, the classifier, a tool-enforced approval): report once, do not bypass. The exact command goes to Chris only for permission dialogs only he can approve.
- Owner-set 2026-10-19: GO means keep going. Do not repeat approval questions for the same scope or authorized publication. Complete checks, GitHub delivery and live proof; ask only for a genuinely missing decision or real approval boundary. See `.ai/rules/owner-go-no-repeat-approval.md`.
- If a production release fails, continue with tests, fixes, a GitHub branch or pull request, and a clear way to ship manually. The manual path is a pull request Chris can merge (GitHub ships it); it is never a deploy or a database command for him. Do not claim a release is live until it is verified.
- Write updates in plain, fourth-grade English. Explain **what works, what is blocked, what you already tried, and one next step**. Avoid developer terms and long technical explanations unless asked.
- Do not end routine replies with "Confirm:" or ask Chris to approve, open, inspect, or repeat the next step. Give the answer or direct link and stop. Ask one question only when a decision or missing fact truly blocks the work.
- A "can't" must come with a practical alternative whenever one exists. Do not invent capabilities, results, estimated dates, or active agents.
- Divide substantial work among independent agents **when actual agent tools are available**. Give each agent distinct files or tasks, put shared progress on an `ops/workflows/` board, and avoid overwriting one another. If agents cannot be started from the present toolset, say so and keep working with the available tools.
- Make the change in GitHub and give a direct link. Do not ask the owner to copy source files or run terminal commands when you have a connected tool to do it.
- Chris's standing authorization covers routine use of available accounts, sessions, APIs, CLIs, and credentials for the task he assigns, including Apple Developer and App Store Connect. The account access is standing for all later work. Owner-set 2026-10-24: standing, not tied to the launch. Do not repeat account-access permission questions. Keep actions in scope and honor any real tool-enforced confirmation. See `.ai/rules/owner-authorized-account-ops.md`.
- Protect real recordings, money, and customer data. Do not loosen safety checks or claim success to make a status light green. Keep a failed proof red; repair the test or bug, or state the exact blocker.
- **Remove before add.** Reuse working code and established naming and routing rules. Build a new feature only when the owner asks for it.

## Finish the requested outcome

**Owner rule, 2026-10-20:** finish the approved job; do not hand back a checkpoint while an authorized next step remains. Law: `.ai/rules/finish-the-requested-job.md`.

- A commit, pull request, saved plan or passing test count is not completion. Compare the delivered result with the original requested outcome before ending the turn.
- A failure in a required build, verification, dependency or release check stays part of the approved job, including adjacent or pre-existing code. Diagnose it, make the smallest justified repair and rerun the check. Do not ask whether to expand the job merely to clear that required check.
- If safe, authorized work can still advance the outcome, continue it. A status question or request to update these rules does not cancel the unfinished job or reset approval.
- Keep failed proof red. Do not weaken, skip or delete checks, hide a failure with repeated reruns, or turn production integrations into mocks to claim completion.
- Stop only for the verified requested outcome, an explicit user pause, or a genuine owner-only decision, missing input, tool-enforced confirmation or unavailable external prerequisite after safe in-scope alternatives are exhausted. State the exact evidence, what was tried and the one needed decision; never substitute a PR handoff for the job.
- Keep unrelated improvements as board leftovers. This rule does not grant new product scope, production go-live approval, live customer or money changes, credential changes, deletion or database repointing.

## Scope and evidence

- Work on the named task only. Do not fix other holes you happen to find. Record a separate leftover on the shared board, then return to the task.
- Read a file before editing it. Read the intended journey in `docs/journeys/` before changing a flow. Do not change an intended journey to excuse a code change; update the `-actual.md` journey from verified code when the flow changes.
- Look up facts you can check in the repo, Drive, logs, or the live site. Before claiming something is missing, search the places it could live, including `src/`, `scripts/`, `db/`, and `docs/`. Never invent a result or call a skipped check a pass.
- For `public/app/` work, read `docs/rules/UI-STANDARDS.md`. Keep a new live page, API route, job, or send path covered by the heartbeat rules in `docs/journeys/heartbeat-flow.md`; money or customer paths also need their tripwire proof.
- Mark screenshots used as review or fix evidence with numbered red circles and yellow arrows around the exact issue and a short caption. Keep approved deliverables and decisions in this repo, not only in chat.
- Do not create new .md files unless I ask for one. Update an existing file instead. (owner-set 2026-10-24). Law: `.ai/rules/no-new-markdown.md`.

## Proof, Git, and release

- Run the checks that cover the change. For code, include lint, TypeScript, and the relevant automated tests; check a changed UI with Playwright. State any check you could not run and say how many database tests skipped. Database tests that skip without `DATABASE_URL` are not proof. TypeScript (`npx tsc --noEmit`) runs only when TypeScript is installed.
- `npm test` finds tests under `src/` and `scripts/`, not `api/`. `npm run verify:e2e` uses a scratch database with the `fundhub_app` role; never point it at production. A handler is live only when routed in `netlify/functions/api.mjs`.
- GitHub `origin` is canonical; compare with `origin/main`. Commit finished work locally, then push it to GitHub. Push only `main` and branches headed to a PR. Keep unmerged work visible in a pull request. A push to `main` runs `.github/workflows/ship.yml` with `npm run ship`; verify that run and the live result before saying it shipped. If `main` changes without a GitHub push, run `npm run ship` once at the end.
- Do not commit secrets or customer data. Never delete, unset, or overwrite an existing credential. Ask the owner before deleting data (proven test rows and test logins excepted, owner-set 2026-10-24) or repointing `DATABASE_URL`. Never turn off `INNGEST_EVENT_KEY`.
- For page edits, show the marked draft. Publish only with owner authorization; an existing ship/deploy/GO choice for that release is enough, without another go-live question. For ad video names, use `marketing/ads/NAMING.md`; for SLO filmed files, use the SLO Ads root. The company name is **Fundhub**. Testimonial card videos on pages do not need 4K (owner-set 2026-10-24).

## Teleprompter

Before any teleprompter camera or recording repair, follow `docs/rules/TELEPROMPTER-VIDEO.md`.
