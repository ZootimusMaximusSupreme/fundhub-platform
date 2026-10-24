# Phase 3: rules that fight each other

Date: 2026-10-24. Branch: `drift-cleanup`. Agent: `conflicts` (Sonnet). Nothing is committed or pushed. The lead commits.

**The answer:** There are 50 fights between rules, and you decide every one. Each block shows both sides in their own words, why they fight, and what I would do. I did not pick for you. The blocks run from most damage (keys, customers, the live site, money) to least (wording).

How to read this sheet:

- The finders sent 167 reports. Many were the same fight found twice. 13 reports (8 fights) were dropped after I checked them. The other 154 became the 50 fights below. Every quote in a kept fight was found in the committed file.
- Paths and line numbers are as committed at `c54f936a4`. Phase 2 moved the real rule files to `.ai/rules/<name>.md` and the real skill folders to `.agents/skills/<name>/`. So `.cursor/rules/x.mdc` is now `.ai/rules/x.md`, and `.cursor/skills/x/SKILL.md` is `.agents/skills/x/SKILL.md`.
- `memory/...` notes are outside the repo, in `~/.claude/projects/-Users-chrisstanbridge-Developer-fundhub-platform/memory/`. The lead edits those. They are not in git.
- Every "Your pick" line is empty. Tick one box per fight.
- "What I would do" follows one test: the newest owner-set date wins, unless there is a reason not to. When there is a reason, the block says it.

---

## 1. A stored key: leave it alone, or replace it?

**Side A.**

- `CLAUDE.md` line 690, section Never remove a key (owner-set 2026-09-17): "Never delete, unset, clear or overwrite a stored credential. Ever."
- `CLAUDE.md` line 692: "This holds even when the stored value is measured broken right now"

**Side B.**

- `.cursor/rules/env-full-copies-never-masked.mdc` line 26 (owner-set 2026-10-04): "reset it at the vendor and set the new value yourself, without `--secret`"
- `.cursor/rules/secrets-env-law.mdc` line 64 (no date on the line): "Only a mask placeholder (a value that contains `*`) may be replaced."

**Why they fight.** A stored key is a mask (a row of stars). Section 11 says never overwrite it, even when it is broken. The env rules say reset it and set a new value.

**What I would do.** B, for a mask only. A mask is not a key, so nothing real is lost, and every working key stays under A. The 09-17 law came from a masked OpenAI key that got a 401, and B is newer (2026-10-04). One sentence goes into section 11.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 2. Test people on the live site

**Side A.**

- `memory/no-test-data-on-production.md` line 15 (your call, 2026-10-20): "never seed test rows or test logins on production; tests run on scratch databases only."

**Side B.**

- `.cursor/rules/sim-assume-paid.mdc` line 13 (owner-set 2026-08-25): "Mint the person straight into the CRM (plus-tag)."
- `.cursor/rules/full-end-to-end-audit.mdc` line 18 (owner-set 2026-08-25): "five sim files (different client scenarios) through every live path"
- `.cursor/skills/fundhub-ui-auditor/SKILL.md` line 14: "logged in with the existing e2e+ test accounts"

**Why they fight.** On 2026-10-20 you had the fake rows and the 7 test logins removed from the live database. The older rules still send agents to make test people there and to log in with test accounts. No rule in the repo holds your 10-20 call. The note says so itself: "No repo rule file existed for this as of 10-20".

**What I would do.** Something else. Test people go on the live site only inside a Full End-To-End Audit that you order, and the agent removes them right after with the guarded delete (your 2026-10-24 rules allow deleting proven test rows). Every other test runs on a scratch database. Your newest call (10-20) says no test data on live, and your audit door (08-25) is live on purpose, so this keeps both. Say so, and your 10-20 call is also written as a law.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 3. src/mail: off on purpose, or a broken path to fix?

**Side A.**

- `CLAUDE.md` line 769, section 12: "`src/mail/` mails nothing, deliberately. No scheduler, no send path, no activation flag. The build is not gated; the drop is not built."

**Side B.**

- `.cursor/rules/product-is-live.mdc` line 15 (owner law 2026-08-21, marked FINAL): "If a path is not live, that is a FAIL / broken finding or a named Fixer task"
- `.cursor/rules/features-stay-on.mdc` line 8 (owner law 2026-10-20): "Turn on all features. Keep everything on permanently."

**Why they fight.** An agent that follows product-is-live reads the mail module as broken and wires it up. That mails real people. The same rule says an exception counts only when you name that exact switch. You named Plaid. You have not named direct mail.

**What I would do.** A. You add "direct mail (`src/mail`) stays unbuilt" to the Named exception list in product-is-live, next to Plaid. Only you can name an exception, and a wired mail drop reaches real people.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 4. How a database change reaches the live site

**Side A.**

- `CLAUDE.md` line 669, the ship bullet (owner-set 2026-09-16, inside the 2026-10-09 bullet): "This replaces the two bullets below for deploys and SQL"
- `CLAUDE.md` line 666: "database changes through the Supabase key the MCP already uses (`SUPABASE_ACCESS_TOKEN`),"

**Side B.**

- `CLAUDE.md` line 684 (no date): "Apply new SQL yourself" with the command on line 685: `DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node db/migrate.mjs`
- `CLAUDE.md` line 728: "Running `node db/migrate.mjs` by hand is unaffected"

**Why they fight.** Line 669 says ship replaces the SQL bullet, but line 684 still gives a hand command that cannot work. `DATABASE_URL` is the limited app user, which "cannot change tables" (`docs/sops/postgres-least-privilege.md` line 358), and `db/migrate.mjs` line 155 says "Do not export `netlify env:get` into the shell." Line 666 is out of date too: the Mac's own Supabase key gets a 401, and the GitHub runner applies the SQL (`memory/ship-traps-2026-10-05.md` line 26, measured 2026-10-20). This session's own Supabase connection was refused with a 401 as well.

**What I would do.** A. Ship through GitHub is the one path for SQL. Rewrite lines 684 to 685 to say: push `main`, GitHub applies the SQL, the Mac deploys only when pending is 0. Drop the `DATABASE_URL` hand command, and fix line 666 to match. Line 728 stays, because it is about the production-only guard. The newest facts (2026-10-20, measured) back A.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 5. What gets pushed to GitHub (the repo is public)

**Side A.** Older lines still say push everything.

- `CLAUDE.md` line 147: "Then push that commit to GitHub when auth allows."
- `AGENTS.md` line 51: "Commit finished work locally, then push it to GitHub."
- `.cursor/skills/fundhub-version-control/SKILL.md` line 13: "then push it to GitHub with `node scripts/github-push-whole-repo.mjs`"
- `scripts/ship.mjs` line 241 (this is code): "Pushed to GitHub: main, unmerged local branches, and every tag."
- `memory/repo-sweep-2026-10-21.md` line 8: "saved to GitHub as `backup/*-2026-10-21` branches"

**Side B.** The newest law.

- `CLAUDE.md` line 144 (owner-set 2026-10-24): "push only `main` and branches headed to a PR"
- `.cursor/rules/github-push.mdc` line 24 (owner-set 2026-10-24): "`node scripts/github-push-whole-repo.mjs` is not the default anymore."
- `.cursor/rules/github-push.mdc` line 50, Do not: "Push a backup branch, or every local branch, to GitHub"
- `memory/github-repo-is-public.md` line 17 (2026-10-21): "Do not push "backup" branches of unsaved work to GitHub"

**Why they fight.** The repo is public. Five places still tell agents to push everything, and one is code: `npm run ship` on the Mac pushes every unmerged branch and tag (step 9 in the file header). Each pushed branch starts a 28-job test run and shows the work to everyone.

**What I would do.** B (newest, 2026-10-24). Phase 4 fixes the text lines and the memory index line. `scripts/ship.mjs` is code, so this cleanup leaves it and puts one named fix on the board. The backup branches already on GitHub stay until you say delete them. Deleting them is your call.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 6. A canary that buys on production, or never charge a real card

**Side A.**

- `memory/verification-is-the-bottleneck.md` line 33 (your ask, 2026-09-23; one of nine countermeasures): "A canary buys something on production every five minutes and shouts"

**Side B.**

- `.cursor/rules/sim-assume-paid.mdc` line 12 (owner-set 2026-08-25): "Never charge a real card."
- `.cursor/rules/agentic-audit-guardrails.mdc` line 15: "Real card charge" (a hard stop unless you say GO in that message)
- `.cursor/rules/heartbeat-on-every-build.mdc` line 21: "No text, no email, no AI call, no Plaid, no credit pull, no card charge."

**Why they fight.** A canary that buys something charges something. The rules ban a real charge. No rule says how a canary buy would be allowed.

**What I would do.** B for now. The canary waits until you name a safe way to buy (a payment provider's test mode, for example). Nothing in the repo allows a live charge, and a charge is your call.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 7. Shipping is blocked: offer Chris a manual path, or never?

**Side A.**

- `CLAUDE.md` line 7 (owner rule 2026-10-12): "if shipping is blocked, offer a simple manual path rather than giving up"
- `AGENTS.md` line 13: "a clear way to ship manually"
- `AGENTS.md` line 67: "If the owner will deploy manually, leave a reviewable GitHub PR and precise manual steps."

**Side B.**

- `CLAUDE.md` line 676, the ship LAW (owner-set 2026-09-16): "never tell Chris to run deploy/migrate commands or touch Netlify or the database by hand"
- `CLAUDE.md` line 180 (owner-set 2026-09-16): "Do not tell Chris to run commands, paste secrets, deploy"

**Why they fight.** The ship is blocked. One line gives you a manual path. The other forbids sending you to deploy by hand.

**What I would do.** Something else. Keep both with one clear line: the "manual path" is a pull request you can merge, and GitHub ships it. It is never a deploy or a database command for you. The 10-12 line is newer, but the 09-16 law protects you from hand work, and a pull request satisfies both.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 8. Ad proof lines: which claims may an ad make?

**Side A.** Old proof lines still sit in the writer prompts.

- `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 254: "Proof — this is the entire list, do not embroider it"
- `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 257: "Over $25 million secured for our clients."
- `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 258: "Koi Poke — one restaurant, already turned away once, now a franchise with multiple locations."
- `marketing/ads/slo/slo-297-prompt-2026-09-18.md` line 895 (a second copy): "Over $25 million secured for our clients."
- `marketing/ads/reference/locked-ads-2026-09.md` line 29: "tens of thousands of data points across the funding ecosystem"
- `.cursor/skills/fundhub-ad-writer/SKILL.md` line 30 sends writers to that prompt: "$297 SLO only:"

**Side B.** Your own words.

- `ops/workflows/ad-scripts-2026-10-02.md` line 36 (your ask, 2026-10-02): "proof is a decade, hundreds of files, thousands of data points, and the million I've funded for myself (no $25 million, no Koi Poke)"
- `marketing/ads/RULES.md` line 83 (Part 0, added 2026-10-05): "A decade in the industry, hundreds of files, thousands of data points. Don't use Koi Poke or $25M."
- `marketing/ads/RULES.md` line 85: "some of his clients were funded 8 years ago"
- `marketing/ads/RULES.md` line 86: "He pulled $100K lines on four companies off one personal file"

**Why they fight.** A writer who follows the SLO prompt puts "$25 million" in a paid ad, and you took that line out. `marketing/ads/reference/locked-ads-2026-09.md` line 5 says "the newer rules in the ad-writing prompt override them", but the prompt still has the old list.

**What I would do.** B. Use your Part 0 list (`marketing/ads/RULES.md` lines 83 to 86), newest at 2026-10-05. It holds two facts more than the board's list of four (`ops/workflows/ad-scripts-2026-10-02.md` line 114: "Proof is only:"). Phase 4 removes the $25M line, the Koi Poke line and the tens-of-thousands line from both SLO prompts and from the locked-ads house rules. They are your own words, and a fact in an ad must stay true.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 9. Cloud sessions: the same keys as the Mac, or only GitHub?

**Side A.**

- `.cursor/rules/no-remote-control.mdc` line 16 (owner law 2026-10-09): "give the cloud the same env keys and network access as the Mac."

**Side B.**

- `.cursor/rules/github-ships-main.mdc` line 20 (owner law 2026-10-09, edited 2026-10-24): "It does not need Netlify or Supabase keys, and it does not need those hosts opened."
- `.cursor/rules/secrets-env-law.mdc` line 39 (owner-set 2026-10-04) lists "`npm run ship` from cloud" as a reason a var must be readable by the Mac or Claude cloud.

**Why they fight.** One rule hands the cloud every key and every host. The other says the cloud needs none of them, because GitHub does the ship.

**What I would do.** B. It is the newer edit (2026-10-24), and fewer keys in the cloud is safer. `no-remote-control` then says: "give the cloud the same GitHub path as the Mac."

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 10. The `--secret` flag: banned, or "when needed"?

**Side A.**

- `.cursor/skills/fundhub-fixer/SKILL.md` line 55: "New env vars: set them yourself (secret when needed)"
- `docs/sops/RUNBOOK.md` line 183: "`--secret` goes on anything holding a password. Always."
- `docs/sops/postgres-least-privilege.md` lines 234, 249 and 324 also set a database URL with `--secret`.

**Side B.**

- `CLAUDE.md` line 677 (owner-set 2026-10-04): "`--secret` is banned for laptop/cloud-readable keys"
- `.cursor/rules/secrets-env-law.mdc` line 40 (owner-set 2026-10-04): "`--secret` only when nothing off Netlify runtime ever needs the plaintext again (almost never — ask Chris if unsure)."

**Why they fight.** Netlify never gives a `--secret` value back (`.cursor/rules/secrets-env-law.mdc` line 51: "Netlify `--secret` vars cannot be revealed"). The 2026-10-04 law bans it (`.cursor/rules/secrets-env-law.mdc` line 28: "These burned the laptop `.env` and Claude cloud."), but the fixer skill and the RUNBOOK still tell agents to use it.

**What I would do.** B (newest, 2026-10-04). Phase 4 changes the fixer line, the RUNBOOK lines and the SOP commands. The other RUNBOOK clashes are in #27.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 11. Printing keys in chat: never, or paste when Chris asks?

**Side A.** These are Never-list lines.

- `.cursor/rules/chris-never-submagic.mdc` line 22 (owner-set 2026-09-24): "Print API keys, passwords, or `.env` values in chat or commits"
- `.cursor/rules/chris-never-clickfunnels.mdc` line 20 (owner-set 2026-09-21): "Print API keys, webhook secrets, or `.env` values in chat or commits"
- `.cursor/skills/fundhub-fixer/SKILL.md` line 56: "Never print secret values. Confirm by name only."

**Side B.**

- `.cursor/rules/show-secrets-when-chris-asks.mdc` line 14 (owner-set 2026-10-04): "Paste the complete string in the reply."
- `CLAUDE.md` line 686 (owner-set 2026-09-25): "Dictator mode or you explicitly ask for a value → paste it when readable."

**Why they fight.** Only the show-secrets rule has the exception for when you ask. The other lines ban printing with no "unless he asks". An agent that reads only one of them does the wrong thing.

**What I would do.** B. The exception stays. Phase 4 adds "unless Chris asks for the value (`show-secrets-when-chris-asks`)" to each Never line and the fixer skill. B is newer than the Submagic and ClickFunnels rules, and nothing else changes.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 12. The stuck rule: stop after two tries, or keep repairing

**Side A.**

- `CLAUDE.md` line 580, section 8 (no date): "Two failed attempts at the same fix, stop."
- `.cursor/skills/fundhub-fixer/SKILL.md` line 29 and `.cursor/skills/fundhub-orchestrator/SKILL.md` line 42 copy it: "Two chances per ticket."

**Side B.**

- `.cursor/rules/finish-the-requested-job.mdc` line 15 (owner rule 2026-10-20): "Stop only when the requested outcome is verified, the user explicitly pauses, or a genuine owner-only decision/input"
- `AGENTS.md` line 28: "Diagnose it, make the smallest justified repair and rerun the check."
- `.cursor/rules/approved-launch-release-blockers.mdc` line 10 (2026-10-17): "Reproduce the failure, make the smallest real fix, and rerun the check."

**Why they fight.** A required check fails twice. Section 8 says stop and never try a third time. The finish rules give a short list of reasons to stop, and "failed twice" is not on it.

**What I would do.** B for required checks, and keep the point of A: no third try of the same fix. A third try must be a different fix with new proof. B is newer (2026-10-20). One line goes into section 8 saying so.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 13. Scope grows past double: stop and re-scope, or keep going

**Side A.**

- `CLAUDE.md` line 586, section 8 (no date): "If the work grows past roughly double what the plan estimated, stop and re-scope with me."
- `.cursor/skills/fundhub-orchestrator/SKILL.md` line 46 adds a third stop: "if model usage in the session crosses ~80% of remaining quota, checkpoint the board and stop cleanly"

**Side B.**

- `.cursor/rules/finish-the-requested-job.mdc` line 11 (owner rule 2026-10-20): "do not ask to expand scope just to repair a required check"
- `AGENTS.md` line 28: "Do not ask whether to expand the job merely to clear that required check."
- `.cursor/rules/owner-go-no-repeat-approval.mdc` line 15 (2026-10-19): "Ask one question only when a missing fact, genuinely new scope, owner-only decision, or real tool-enforced approval blocks the next action."

**Why they fight.** A required build or release check needs far more work than planned. Section 8 says stop, and the finish rules say repair it and do not ask. `CLAUDE.md` line 43 says the finish rule qualifies the section 2 stop. It does not mention section 8.

**What I would do.** B for required checks, A for new product scope. One line in section 8: a required check never counts as "double the estimate". B is newer (2026-10-20).

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 14. A guard blocks the agent: find a way around, or stop?

**Side A.** Find a way.

- `CLAUDE.md` line 7 (owner rule 2026-10-12): "If something blocks the task, find a practical way forward instead of waiting."
- `AGENTS.md` line 11: "Look for the simplest safe way around it, do the parts that remain possible, and keep going."
- `memory/full-authorization-means-find-the-best-path.md` line 8 (2026-09-23 to 24): "if you give me pushback on something, find the best solution". The same line names "a permission classifier refusing a write" as a block to route around.

**Side B.** Stop.

- `CLAUDE.md` line 744, Egress: "A 403 from the proxy is an org policy denial: report the blocked host, do not retry or route around it."
- `CLAUDE.md` line 604 (looked up 2026-10-24): "do not retry the 403, and do not route around it"
- `memory/password-reset-blocked-for-agents.md` line 15 (2026-09-18): "do not retry a blocked password reset or look for a way around the block." The same line says "Put the exact one-line command in a `bash` block for Chris." That fights `CLAUDE.md` line 180: "Do not tell Chris to run commands".

**Why they fight.** A host or a permission is denied by policy. Line 7 says find another way, and the Egress section and the password note say report it and stop.

**What I would do.** Something else. A rule block, like the key rule in #1, gets the best move that keeps the rule. A policy or permission block (a 403, the classifier) is reported once and not bypassed. The exact command goes to you only for the permission dialogs you alone can approve (`CLAUDE.md` line 182). Bypassing a security block is the one thing an agent must not do. Line 7 stays for everything else.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 15. The orchestrator skill's "never touch" list is out of date

**Side A.**

- `.cursor/skills/fundhub-orchestrator/SKILL.md` line 45 (no date): "Never touched, ever, without an explicit line in the approved plan: payments/Commas, live client records, GHL workflows, env/secrets"

**Side B.**

- `CLAUDE.md` line 677 (owner-set 2026-10-04): "A new env var is yours to set."
- `.cursor/rules/ghl-blacklisted.mdc` line 8 (owner law 2026-09-19): "Fundhub does not use GoHighLevel (GHL)."

**Why they fight.** The skill treats GHL workflows as a live system to protect and env/secrets as hands-off. Your laws say GHL is out and agents set env vars. `.env.example` lines 47 to 49 still list `GHL_API_KEY` with "Contact sync may still read these; do not use for send."

**What I would do.** B. Phase 4 removes "GHL workflows" from the skill line and changes "env/secrets" to "stored keys (never delete or overwrite)". Both laws are newer than that skill line. The `.env.example` lines are old leftovers, not new adds, so I would leave them.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 16. Who writes the "intended" journey files?

**Side A.**

- `CLAUDE.md` line 487, section 4: "`<name>-intended.md` — hand-authored. What should happen. Source of truth. Agents do not edit this file."
- `.claude/settings.json` line 22 (the hook blocks the write): "intended journey files are human-authored"

**Side B.**

- `.cursor/skills/fundhub-builder/SKILL.md` line 66: "Builder writes it; Chris approves it."
- `docs/journeys/README.md` line 16 (2026-08-02): "the owner directed a one-time exception: each `-intended.md` was generated"
- `docs/journeys/README.md` line 20: "Treat them as a starting draft for a human to revise"

**Why they fight.** A new screen needs its journey file. The builder skill has the agent write it, but section 4 says only a human does, and the hook stops the agent. The README says the existing ones were generated once, and section 4 never mentions that.

**What I would do.** A. Keep section 4. The builder drafts the steps on its board file, and you write or approve the intended file by hand. Add one line to section 4 that points to the README exception. An agent that writes the truth its own work is checked against has no check.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 17. "Zero Broken" against the rows you said stay red

**Side A.**

- `.cursor/rules/owner-calls-settled.mdc` line 12 (owner law 2026-10-24): "Its pulse row stays red, labelled "owner declined"."
- `.cursor/rules/owner-calls-settled.mdc` line 14: "His two reds are not a to-do."

**Side B.**

- `.cursor/rules/monday-100-percent.mdc` line 14 (owner law 2026-10-14): "Every item on the heartbeat is green or a verified "nothing to judge". Zero Broken."
- `.cursor/rules/monday-100-percent.mdc` line 44, Never: "Report the goal done while any item is Broken, Not proved or Not checked."

**Why they fight.** The settled-calls rule keeps one pulse row red on purpose and says client FH-000507's two reds are not a to-do. The Monday standard says no item may be Broken before the goal is done. Both cannot be true.

**What I would do.** A. Add "except the rows you settled in `owner-calls-settled`" to the Monday standard. The settled-calls rule is newest (2026-10-24), and you made those calls on purpose.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 18. The session-start hook forces the split, even for a Full End-To-End Audit

**Side A.**

- `.claude/settings.json` line 10 (and `.codex/hooks.json` line 19): "MANDATORY FIRST STEP — CLAUDE.md section 0. State the workflow split"

**Side B.**

- `.cursor/rules/full-end-to-end-audit.mdc` line 10 (owner law 2026-08-25): "do not run CLAUDE.md §0 in this turn. No workflow table."
- `CLAUDE.md` line 15: "No exceptions, except Full End-To-End Audit"
- `AGENTS.md` line 7: "Exception: if Chris said Full End-To-End Audit (or full e2e), skip the split this turn"

**Why they fight.** You say Full End-To-End Audit. The rule says skip the split, ask the two gate questions, and stop. The hook has no such exception, and Phase 7's new hook block (`phase-7-hooks.md`) copies it.

**What I would do.** B. Add the exception sentence to the hook text in `.claude/settings.json` and `.codex/hooks.json`, and in Phase 7's block before it is wired. The hook is the one place that still lacks it.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 19. A fix needs a file you did not name: ask, or just fix it?

**Side A.**

- `memory/just-fix-the-named-hole.md` line 11 (2026-09-18): "go fix the real cause without asking"

**Side B.**

- `.cursor/rules/owner-scope-minimal-diff.mdc` line 28 (owner law 2026-08-16): "Otherwise stop. Ask one question. Wait for his answer."
- `.cursor/rules/owner-scope-minimal-diff.mdc` line 30: "Do not touch the file and mention it after."
- `CLAUDE.md` line 76: "You are about to change a file he did not ask to change"

**Why they fight.** The real cause of a named hole sits one layer over, in a file you did not name. The note says fix it, and the rule says stop and ask. The rule's two exceptions (a failed required check, a named board row) do not cover this.

**What I would do.** A, narrowly. A third exception goes into the rule: same named hole, same symptom, cause one layer over, then fix it without asking. Everything else stays stop-and-ask. The note (2026-09-18) is newer than the rule's base date (2026-08-16), and you were angry about the extra question.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 20. Cursor models are told to change screens, but only Claude may

**Side A.**

- `.cursor/rules/no-claude-in-cursor.mdc` line 31, Example (owner-set 2026-09-18): "Change the copy here with Composer or Grok."
- `.cursor/rules/ui-standards.mdc` line 9 (2026-10-20): "Read `docs/rules/UI-STANDARDS.md` before building or changing a screen."
- `.cursor/rules/no-claude-in-cursor.mdc` line 13, Never: "Tell Chris to “leave it for Claude” or spawn Claude for screens, copy, or fixes"

**Side B.**

- `.cursor/rules/grok-no-displays.mdc` line 14 (owner law 2026-08-28, extended 2026-09-21): "Copy on buttons, labels, or any visible control"
- `.cursor/rules/grok-no-displays.mdc` line 20: "If a request needs a website or a design change, stop. Leave it for Claude."
- `.cursor/rules/no-claude-in-cursor.mdc` line 18, Exception (owner-set 2026-09-21 and 2026-10-24): "A Cursor agent does not do them and does not spawn Claude for them."

**Why they fight.** The same file that bans display work for Cursor models also gives an example where a Cursor model changes button copy. `ui-standards.mdc` exists only for Cursor and tells it to build screens. The Cursor models (Grok and Composer) are barred from screen work.

**What I would do.** B (newest, 2026-10-24). Phase 4 rewrites the Example to "write the need on the board". `ui-standards.mdc` is archived, because it has no audience: Claude gets the standards through `CLAUDE.md`.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 21. Chris checks by hand, or the agent does all checking

**Side A.** You do two hand checks.

- `.cursor/rules/monday-100-percent.mdc` line 38 (owner law 2026-10-14): "Chris walks the money and customer items one by one to confirm each is accurate."
- `AGENTS.md` line 67: "check the shipped site on a real iPhone before calling the teleprompter ready to film"
- `docs/rules/TELEPROMPTER-VIDEO.md` line 15: "Prove each stage before asking for another owner test."

**Side B.** You do none.

- `.cursor/rules/live-playwright-100-before-manual.mdc` line 8 (owner law 2026-08-25): "do not ask him. Agent walks it."
- `CLAUDE.md` line 180 (owner-set 2026-09-16): "Do not tell Chris to run commands, paste secrets, deploy, check inboxes, or do routine QA clicks."

**Why they fight.** Who confirms that a money check is accurate, and who holds the iPhone? Two rules say you do. Two say the agent does it all. `CLAUDE.md` line 182 lists the only exceptions (permission dialogs, product gates, the two ask-first items), and neither check is on it.

**What I would do.** A, for these two checks only. Only you hold the phone, and you asked for the money walk. Everything else stays agent-only. Add both to the exception list in `CLAUDE.md` line 182 and to the live-playwright rule. Both asks come after the 2026-08-25 law: the teleprompter work is dated 2026-10-13, and the money walk 2026-10-14.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 22. Prove the fix yourself, or a different tester?

**Side A.**

- `.cursor/rules/three-step-repair.mdc` line 14 (owner law 2026-08-26): "FINISH — prove it yourself on the live site (click twice if UI). Write PASS/FAIL. STOP."
- `.cursor/skills/fundhub-fixer/SKILL.md` line 49 (the Prove path) has the fixer walk the live path and finish.

**Side B.**

- `.cursor/rules/named-fix-regression-gate.mdc` line 16 (owner law 2026-09-18): "After FIX, a different tester than the fixer must try to recreate the same hole on live."
- `.cursor/rules/named-fix-regression-gate.mdc` line 29, Never: "Let the fixer mark done"

**Why they fight.** The gate says (line 8) that it "wins on done over three-step-repair.mdc FINISH". But the FINISH text and the fixer's Prove path were never changed. They still say the fixer proves it and stops.

**What I would do.** B. The gate is newer (2026-09-18) and says it wins. Phase 4 rewrites FINISH and the Prove path so a different agent does the second try.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 23. The done list asks for checks that cannot run here

**Side A.**

- `CLAUDE.md` line 559 (section 6): "Never report a task complete until all of these pass:"
- `CLAUDE.md` line 562: "`npx tsc --noEmit`"
- `CLAUDE.md` line 563: "Test suite green — no skipped, deleted, or weakened tests"

**Side B.**

- `.github/workflows/tests.yml` line 13: "`npx tsc --noEmit` — there is no TypeScript in this repository."
- `.github/workflows/tests.yml` line 36: "WITHOUT a DATABASE_URL, 442 `.pg.test.mjs` tests SKIP"
- `.github/workflows/tests.yml` line 41: "THIS JOB BLOCKS."
- `AGENTS.md` line 49: "State any check you could not run."

**Why they fight.** `package.json` has no `typescript`, so the tsc check has nothing real to run. Without a database, 442 tests skip, and this Mac has no Postgres (`memory/ship-traps-2026-10-05.md` line 15: "This Mac has no Postgres and no Homebrew"). Section 6 says nothing may skip, while `AGENTS.md` says to name what could not run.

**What I would do.** B. Section 6 takes the `AGENTS.md` wording: name any check that could not run here, and say how many database tests skipped. CI's Postgres jobs give the skip-free proof. The tsc line says it runs only when TypeScript is installed. This matches `AGENTS.md` line 49: "Database tests that skip without `DATABASE_URL` are not proof."

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 24. New env vars: "then ship once", or ship only when main changed

**Side A.**

- `CLAUDE.md` line 679: "Set every variable first, then ship once via `npm run ship`"

**Side B.**

- `CLAUDE.md` line 664 (owner-set 2026-10-09): "Run `npm run ship` on the Mac once, at the end, only when `main` changed without a GitHub push."
- `CLAUDE.md` line 668: "It skips when nothing changed"

**Why they fight.** Setting env vars changes nothing in `main`. Ship skips when nothing changed. So the ship step does nothing, and no rule says what makes a new value live. `CLAUDE.md` line 681 says a new value "simply sits there until the next build picks it up."

**What I would do.** B (newest, 2026-10-09). Line 679 becomes: set every variable first; the next push to `main` ships once and picks them up. If you want an env-only deploy, that needs a change to `scripts/ship.mjs`, and it goes on the board as a named fix.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 25. Who builds: Codex, Claude, or Sonnet then Opus?

**Side A.**

- `.cursor/rules/monday-100-percent.mdc` line 36 (owner law 2026-10-14): "Codex builds, Claude tests."
- `ops/workflows/broken-walkthrough-plan-2026-10-14.md` line 19: "Codex-build, Claude-test batch"

**Side B.**

- `memory/model-follow-through.md` line 15 (2026-10-09): "Default real builds, fixes and the pulse fixer routine to Claude."
- `.cursor/rules/model-by-job.mdc` line 10 (2026-10-06): "Per feature: a Sonnet back-end agent, then an Opus front-end agent"
- `.cursor/rules/grok-lattice-overseer-perpetual.mdc` line 15 (Cursor-only; 2026-09-20): "Spawn Composer from lattice copy-paste prompts."

**Why they fight.** Four answers to one question. The memory index (`memory/MEMORY.md` line 30) says "Grok claims done and is not; Composer stops mid-task", so real builds go to Claude.

**What I would do.** Something else. Keep A (Codex builds, Claude tests) for the Monday sweep, and keep model-by-job (Sonnet back end, then Opus front end) for new features. A is the newest (2026-10-14), and it already has Claude test every build, which is what the 10-09 note asks. Phase 4 adds "prove it from the live result" to the Monday line, and ends the lattice rule's Composer spawning.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 26. When does the refactor start?

**Side A.**

- `.cursor/rules/monday-100-percent.mdc` line 18 (owner law 2026-10-14): "The whole board stays clean for 48 hours (Saturday and Sunday) before refactor starts Monday."
- `.cursor/rules/monday-100-percent.mdc` line 45, Never: "Start the refactor before the 48-hour clean watch is over."

**Side B.**

- `memory/refactor-goal-reusable-base.md` line 11 (owner-set 2026-10-21): "starts Tuesday 2026-10-27"

**Why they fight.** The rule's status line says the goal date has passed, but it keeps the old schedule. The memory gives a later date for the same refactor, and it says you consider the build done. `CLAUDE.md` line 290 still says "By Monday 2026-10-19".

**What I would do.** B (newest, 2026-10-21). The start is Tuesday 2026-10-27. Phase 4 rewrites the Monday schedule lines and `CLAUDE.md` line 290 to match. Pick Something else if you want the 48-hour watch to stay a gate before the start.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 27. The RUNBOOK and README teach old facts

All are old docs against newer laws. Same call for each.

**Side A.** The old docs.

- `docs/sops/RUNBOOK.md` line 96: "Nothing applies them automatically." (against `CLAUDE.md` line 718, 2026-08-19: "`[context.production]` migrates.")
- `docs/sops/RUNBOOK.md` line 129: "Claude cannot run this for you." (against `CLAUDE.md` line 180, 2026-09-16: agents run the work)
- `docs/sops/RUNBOOK.md` line 308: "There is no monitoring and no alerting running today." (against `.cursor/rules/heartbeat-on-every-build.mdc` line 26, 2026-10-09: "Every hour the company tests itself")
- `docs/sops/RUNBOOK.md` line 269: "An email nobody reads at 2am is the same as no monitor at all." (against `.cursor/rules/texting-hours.mdc` line 20, 2026-10-09: "Text Chris at night, for any reason, including a brand-new break.")
- `ops/workflows/pulse-layer-2026-10-09-brief/04-alerts-and-github.md` line 65 has the same clash: "text at once"
- `docs/sops/RUNBOOK.md` line 328: "This system does not send anything out." (against `CLAUDE.md` line 768: a dispatcher "scheduled by" a job every 5 minutes; and `.cursor/rules/product-is-live.mdc` line 12). `docs/sops/README.md` line 21 says "Do not dump the paused outbound queue."
- `README.md` line 3: "one Vercel company, one Postgres database, one event stream" (against `DEPLOY.md` line 3: "The old Vercel and Neon steps that used to be on this page are gone. Do not use them.")

**Side B.** The laws above. The `--secret` lines are #10.

**Why they fight.** These pages were written before the owner laws of August to October 2026. A reader who follows them is wrong on six counts.

**What I would do.** B. Put a dated banner at the top of the RUNBOOK and the SOP README: "Written before the owner laws of Aug to Oct 2026. Where this page and `CLAUDE.md` disagree, `CLAUDE.md` wins." Then fix the six lines. Every law named here is newer.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 28. Who pastes the cloud env block?

**Side A.**

- `.cursor/rules/env-full-copies-never-masked.mdc` line 15 (owner law 2026-10-04): "with that script before Chris pastes cloud env vars"
- `.cursor/rules/env-full-copies-never-masked.mdc` line 34, the ✅ example: "open credentials/cloud-env-for-claude.txt → pbcopy."

**Side B.**

- `.cursor/rules/agents-run-ops-not-chris.mdc` line 18 (owner law 2026-10-04): "Chris does not hand-copy env blocks as the default"

**Why they fight.** Both are owner law from the same day. One builds the file so you can paste it into the Claude cloud settings. The other says you do not hand-copy env blocks. The second says "as the default" but names no exception.

**What I would do.** Something else. Name the exception: the one paste into the Claude cloud settings page. Only you can click that page, so the agent builds the file and copies it to your clipboard. Everything else is agent-run. Add that to the "Only ask Chris when truly interactive-only" list in `agents-run-ops-not-chris`.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 29. `pulse:prove` "must say OK" against Mac runs that show red

**Side A.**

- `.cursor/rules/heartbeat-on-every-build.mdc` line 25 (owner law 2026-10-07 and 2026-10-09): "It must say OK before you call the build done."

**Side B.**

- `memory/non-nested-worktree-recipe.md` line 15 (2026-10-21): "the other key rows go red on a laptop, same set every run"
- `memory/laptop-prove-reds-are-masks.md` line 15 (2026-10-10): "Only the live row counts."

**Why they fight.** On the Mac, key rows go red from masked `.env` values, every time. The run also fails when the whole-morning step takes more than 20 seconds under Mac load. So "OK on the Mac" cannot happen.

**What I would do.** B. The rule gets one line: on the Mac, OK means no reds except the known laptop key rows, and the newest live scorecard row decides. The memory notes are measured and newer.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 30. Audit skills say no commits

**Side A.**

- `.cursor/skills/fundhub-perf-auditor/SKILL.md` line 12 and `.cursor/skills/fundhub-ui-auditor/SKILL.md` line 12: "No fixes, no commits, no branches."
- `.cursor/skills/fundhub-auditor/SKILL.md` line 87, out of scope: "Deploys, commits, env changes"

**Side B.**

- `CLAUDE.md` line 137 (owner-set 2026-09-08): "commit to the local repository in the same session the work is done, every time"
- `CLAUDE.md` line 450 (section 3b, owner rule 2026-09-03): "Every deliverable, decision, list, script, and rule produced in a Claude session gets written to this repository in the same session"

**Why they fight.** Audits write a board and evidence files into the repo, then the skill says not to commit them. `CLAUDE.md` says every session commits, because an uncommitted file was lost once.

**What I would do.** B (newest, 2026-09-08). "No commits" becomes "no app-code changes". Auditors commit their board and evidence files like everyone else.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 31. The compliance label: dead in `CLAUDE.md`, ordered elsewhere

**Side A.** Files that still order or carry it.

- `marketing/ads/RULES.md` line 253: "COMPLIANCE REVIEW REQUIRED goes at the top of any summary for a script that touches dispute"
- `marketing/ads/RULES.md` line 255: "That is `CLAUDE.md` §7 and it is a label Chris asked for"
- `docs/specs/W1-money-model.md` line 4: "Per CLAUDE.md §7 that label stays on it."
- Also in `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md` line 1 (the file title), `marketing/avatars/partner/COPY-DIRECTIVES.md` line 45, `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 3, `docs/specs/W3`, `W4`, `W6`, `W7` (line 3 each), and 56 more files (docs, marketing, old boards and a few tests).

**Side B.**

- `CLAUDE.md` line 572, section 7 (owner-set 2026-09-08): "No `COMPLIANCE REVIEW REQUIRED` label and no compliance/legal/regulatory nag in summaries, commits, or reports."

**Why they fight.** Section 7 is dead. `RULES.md` cites section 7 as the source of a label that section 7 now bans. 225 files in `api/`, `db/` and `src/` also mention the label, mostly in comments.

**What I would do.** B, but only where a file tells an agent to add the label: `marketing/ads/RULES.md` lines 253 to 255, `marketing/avatars/partner/COPY-DIRECTIVES.md` line 45, and the first lines of `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md` and `marketing/ads/slo/SLO-CHAT-PROMPT.md`. Old spec banners and the 225 code comments stay as history. Applied migrations cannot be edited anyway. Section 7 is an owner order of no label, so a file that orders one is wrong whatever its date.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 32. The old video pipeline plan teaches names and steps that later laws killed

**Side A.** The plan, written 2026-09-22.

- `marketing/ads/video-pipeline-plan.md` line 155: "043_t01_raw_2026-09-23.mp4"
- `marketing/ads/video-pipeline-plan.md` line 22: "Share the take into the Raw Drive folder"
- `marketing/ads/video-pipeline-plan.md` line 214: "Send it to Submagic with `autoRender` on"
- `docs/journeys/ad-video-flow.md` line 265: "the new "Raw" folder inside SLO Ads"

**Side B.** The later laws.

- `.cursor/rules/ad-naming.mdc` line 31, Never (owner law 2026-09-24): "`086_t01_raw_2026-09-24.mp4`"
- `.cursor/rules/slo-one-filmed-folder.mdc` line 20 (owner law 2026-09-24): "There is no separate “Raw inbox” for Chris to check."
- `.cursor/skills/fundhub-ad-editor/SKILL.md` line 71 (owner-set 2026-10-23): "`autoRender` false."

**Why they fight.** The plan's file names are the shape the naming law calls wrong, its Raw folder is the one the one-folder law says does not exist, and its `autoRender` setting is the opposite of every other file. The plan's "Superseded" banner (line 11) names only the finished-ads folder and the Meta point.

**What I would do.** B. The laws are newer (2026-09-24 and 2026-10-23). Phase 4 widens the plan's banner to cover names, the Raw folder and `autoRender`, and fixes line 265 in the flow doc.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 33. Where do Direct Book recordings go?

**Side A.**

- `marketing/ads/NAMING.md` line 126: "Filmed files live in SLO Ads root only"

**Side B.**

- `.cursor/rules/slo-one-filmed-folder.mdc` line 10 (owner-set 2026-10-24): "Direct Book filmed videos go in their own Drive folder"
- `AGENTS.md` line 65: "Never place Direct Book recordings in the SLO folder."

**Why they fight.** `NAMING.md` names Direct Book files in the same document (lines 55 to 105), then says all filmed files live in SLO Ads.

**What I would do.** B (newest, 2026-10-24). Line 126 becomes: filmed SLO files live in SLO Ads root only; Direct Book has its own folder.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 34. Are testimonials filmed in 4K?

**Side A.**

- `AGENTS.md` line 61 (owner call 2026-10-13): "VSLs, thank-you videos, and testimonials use full-frame 4K at a hard 30 fps."
- `.cursor/rules/teleprompter-camera.mdc` line 15 (2026-10-13): "VSLs, thank-you videos and testimonials film at 4K"
- `docs/rules/TELEPROMPTER-VIDEO.md` line 13: "VSLs, thank-you videos, and testimonials: full-frame 4K at 30 fps."

**Side B.**

- `.cursor/rules/video-4k-unless-ad.mdc` line 21 (owner-set 2026-10-24): "Testimonial card videos on pages do NOT need 4K"
- `CLAUDE.md` line 218: "Testimonial card videos on pages do not need 4K (owner-set 2026-10-24)."

**Why they fight.** The 10-24 exception reached the 4K rule and `CLAUDE.md`. It did not reach the three teleprompter lines. The 4K rule's own line 16 also still lists "Anything that lives on a page" as 4K required.

**What I would do.** B (newest, 2026-10-24). The same exception sentence goes into the three teleprompter lines, and line 16 of the 4K rule.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 35. The teleprompter mic label

**Side A.**

- `AGENTS.md` line 65: "Show the real microphone name if the browser provides it, with small live audio levels."

**Side B.**

- `.cursor/rules/teleprompter-camera.mdc` line 20 (locked, owner law 2026-10-13): ""iPhone mic on" for the phone's mic. "Rode on" for a Rode."
- `CLAUDE.md` line 156 says the same.

**Why they fight.** `AGENTS.md` says show the browser's real device name. The locked rule shows two fixed labels. The rule is locked ("Change one only when Chris says so"), and the test `e2e/teleprompter-mic.spec.mjs` holds it.

**What I would do.** B. The locked rule has a test and your word behind it. Phase 4 changes the `AGENTS.md` line to match.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 36. Submagic: what does it do, and who touches it?

**Side A.**

- `CLAUDE.md` line 324 (owner-set 2026-10-23): "Submagic does captions only."
- `.cursor/rules/ad-video-best-of-clips.mdc` line 38 (owner law 2026-09-24): "Submagic's job is captions only (and clean audio)"
- `scripts/rules-retired-phrases.json` line 59: "Submagic gets captions and clean audio only."

**Side B.**

- `.cursor/skills/fundhub-ad-editor/SKILL.md` line 9 (owner-set 2026-10-23): "Submagic only does captions, clean audio and eye contact."
- `.cursor/skills/fundhub-ad-editor/SKILL.md` line 72: "Eye contact has no API switch; it is in the Submagic app only."
- `ops/workflows/animation-builds-2026-10-22.md` line 5 (your pipeline, 2026-10-22): "Submagic edits and adds captions → Chris downloads"
- `ops/workflows/ad-scripts-2026-10-02.md` line 81 (your ask, 2026-10-02): "so I can drop each clip into Submagic under My B-rolls"

**Why they fight.** Three files give three lists of Submagic's job. Eye contact needs the app, but `.cursor/rules/chris-never-submagic.mdc` line 14 (owner law 2026-09-24) says "A browser login is not the path." The 10-22 board has you downloading from Submagic, but `.cursor/rules/ad-video-best-of-clips.mdc` line 36 says "Chris never opens Submagic."

**What I would do.** Something else. Submagic does captions and clean audio: the rule and the retired-phrases check both say that. Eye contact waits until you say an agent may drive the app, because the API-only law forbids it. The 10-22 board line and the 10-02 ask are history, and Phase 4 corrects the board.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 37. "Run the skills" means no sound edit, but every video must be at -14

**Side A.**

- `.cursor/rules/animation-ad-style.mdc` line 27 (owner law 2026-10-23): "means add animations only: no cuts, no sound edit."

**Side B.**

- `.cursor/rules/ad-sound-level.mdc` line 15 (owner law 2026-10-23): "A video that is not at -14 is not done."
- `.cursor/rules/ad-sound-level.mdc` line 14: "After Submagic, measure again. If it moved more than 1 LU, set it back to -14."
- `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 27, step 7: "Every finished video gets set to -14 LUFS"

**Why they fight.** Running the animation skill on a Submagic download includes step 7, which resets the sound to -14. Those downloads measured -27 to -30. The style rule says no sound edit.

**What I would do.** B. The level reset stays. "No sound edit" becomes "no cuts and no sound clean-up, except the -14 level reset". The sound rule says a video not at -14 is not done.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 38. Animation skill against the animation rules

Four small clashes with one cause: the skill and a memory index line are older than the 2026-10-24 rule.

**Side A.** The older lines.

- Behind him: `.cursor/rules/animation-overlay-on-spoken-words.mdc` line 15 (2026-10-23): "only decoration goes behind him"
- Behind him: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 56: "only decoration (cash stacks, card margins) goes behind him"
- Closing ask: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 49: "keep clear of them unless Chris says otherwise"
- Length: `.cursor/rules/animation-overlay-on-spoken-words.mdc` line 13: "Stretch a clip inside its catalog length range when the speech runs longer."
- Memory description: `memory/ad-animation-style.md` line 3: "mix behind and in front"

**Side B.** The newer rule and the skill's own later lines.

- Behind him: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 78: "Plates, list rows and money may go behind him."
- Behind him: `.cursor/rules/animation-ad-style.mdc` line 17 (owner-set 2026-10-24): "Behind his head is fine, even across the whole screen"
- Closing ask: `.cursor/rules/animation-ad-style.mdc` line 15 (owner-set 2026-10-24): "The closing ask can carry a CTA animation, but not every ad needs one"
- Length: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 84: "`REMOTION_UNCLAMP=1` lifts the cap so a clip can ride the whole idea"
- Length: `.cursor/rules/animation-ad-style.mdc` line 16: "Animations can be long and ride the whole idea."
- Memory body: `memory/ad-animation-style.md` line 17: "CTA only when it fits, never big by default"

**Why they fight.** A word box behind him, a closing animation and a long clip each get opposite answers from the older lines and the newer ones. `.cursor/rules/animation-builders-opus-placers-sonnet.mdc` line 18 bars a Sonnet placer from "changing a template's prop, length cap or look", and the placer follows the skill that lifts the cap. The memory index (`memory/MEMORY.md` line 64) says "mix in front/behind", but `.cursor/rules/animation-ad-style.mdc` line 17 says "Never in front of his face or head".

**What I would do.** B on all four. The 2026-10-24 style rule is newest. Phase 4 edits the older skill and rule lines, and the memory description line, to match.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 39. Animation test copies: save to the repo, or a scratch folder?

**Side A.**

- `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 28, step 8: "save every round to the repo"
- `.cursor/rules/animation-overlay-on-spoken-words.mdc` line 17: "Save every round to the repo."

**Side B.**

- `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 98, Never: "Outputs go in a scratch folder, not the repo (a test copy is about 250 MB)."

**Why they fight.** The same skill says both. `CLAUDE.md` line 450 says every deliverable goes in the repo. The repo is public.

**What I would do.** Something else. Video files go in a scratch folder. Small files (the schedule, the plan, the notes) go in the repo. A 250 MB copy per round does not belong in a public repo.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 40. Speech-to-text: none on this machine, or whisper.cpp?

**Side A.**

- `.cursor/skills/fundhub-video-animation-overlay/SKILL.md` line 107 (owner-set 2026-10-23): "No local speech-to-text."

**Side B.**

- `.cursor/skills/fundhub-ad-editor/SKILL.md` line 32 (owner-set 2026-10-23): "run whisper.cpp with word times"

**Why they fight.** Both skills need word times for the same kind of video. One reads burned-in captions by eye because it has no speech-to-text. The other runs a local transcriber on the Mac (Mac only, because the path is under `credentials/`).

**What I would do.** B. Replace "No local speech-to-text" with: on the Mac, use the whisper step from the ad-editor skill. Only that Known gaps line is wrong, because step 2 of the overlay skill (line 19) is conditional: "if a speech-to-text tool exists on the machine". Both skills have the same date, and the editor skill proved it on Ad 16.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 41. The watch-curve book against the watch-curve rule

**Side A.**

- `marketing/ads/watch-curve.md` line 65 (no date on the line): "If a running (`ACTIVE`) ad has enough plays and `p25 / plays < 0.5`, Chris gets a buzz"

**Side B.**

- `.cursor/rules/ad-watch-curve.mdc` line 28 (owner law 2026-09-27): "When a running ad dies before 25% and people are not tapping through, buzz him"
- `src/ops/watch-curve.mjs` line 95 (the code): "const hopped = tapsThrough({ clicks, p25: p25N });"

**Why they fight.** The book leaves out the tap-through exception and the texting window (6 a.m. to 10 p.m. Arizona time). The code follows the rule.

**What I would do.** B. The code and the rule agree. Phase 4 updates the one book paragraph.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 42. Are the ad rule books in force or set aside?

**Side A.** Set aside.

- `.cursor/skills/fundhub-ad-writer/SKILL.md` line 16 (2026-10-02): "do not apply or flag `marketing/ads/RULES.md`, `VOICE.md` or the `ads:check` checker against a script"
- `docs/rules/RULES-INDEX.md` line 138: "set aside by the owner on 2026-10-02. Kept. Not applied. Rebuilt later."
- `memory/ad-rules-set-aside.md` line 11 (2026-10-02): "Don't delete or edit them; they stay in the repo."

**Side B.** In force.

- `.cursor/skills/fundhub-ad-writer/SKILL.md` line 44: "`marketing/ads/RULES.md` is law."
- `.cursor/skills/fundhub-ad-writer/SKILL.md` line 107: "Never hand Chris a script that has not passed."
- `marketing/ads/WRITE-ADS-FROM-HERE.md` line 20: "Part 0 (Chris's rules) first, and it wins over everything else"
- `.cursor/rules/ad-second-line.mdc` line 10 (owner-set 2026-09-28): "The hook stays the first two sentences (`marketing/ads/RULES.md`)."
- `memory/ad-rules-2026-10-02.md` line 24 (2026-10-02): "read that Brief before RULES.md"
- `marketing/ads/rules-data.mjs` line 208: "RULES.md Part 0, added 2026-10-05"
- `src/marketing/funnel-copy.mjs` line 283 (code): `checkScriptText(lines.join("\n"), { strict: true })`
- `scripts/ads/check-script.mjs` line 397 (code): "Sixty seconds is the floor, no exceptions (owner-set 2026-09-01)"

**Why they fight.** You set the books aside on 2026-10-02. Three days later your own rules were added as Part 0, and the app's funnel-copy code still checks them. The writer skill says both things, and two memory notes disagree.

**What I would do.** Something else. Part 0 is live: it is your own words and the newest (2026-10-05). Parts 1 to 4, `VOICE.md` and the 135-word floor stay set aside. The floor flags the three sorting-hat ads that run 115 to 125 words on purpose (`memory/ad-rules-2026-10-02.md` line 19: "Sorting-hat ads run 115–125 words, under the checker's 135-word floor on purpose."). The skill, the briefs and the two memory index lines then say so. Phase 7's ad-check hook (`phase-7-hooks.md`) stays unwired, because it runs the old lists, not Part 0.

Your pick: [ ] A  [ ] B  [ ] Something else: ____
---

## 43. Ad scripts and `CLAUDE.md` section 0

**Side A.**

- `.cursor/skills/fundhub-ad-writer/SKILL.md` line 22: "Run `CLAUDE.md` section 0 in one line"
- `CLAUDE.md` line 35: "Say so in one line, give the reason, and continue."

**Side B.**

- `.cursor/skills/fundhub-ad-writer/SKILL.md` line 134, Never: "Never run `CLAUDE.md` §0 or load the whole company to write one script."
- `marketing/ads/WRITE-ADS-FROM-HERE.md` line 12, Do not load: "`CLAUDE.md` section 0 (no split, no workflow board, no parallel prompts)"

**Why they fight.** The same skill says run section 0 in one line, and never run it. `CLAUDE.md` line 15 says section 0 has "No exceptions, except Full End-To-End Audit". Section 0 itself allows a one-line answer when a task cannot be split (`CLAUDE.md` line 35).

**What I would do.** A. The one-line answer matches section 0's own "cannot be split" path. Phase 4 edits skill line 134 and the paste brief line 12 to say "give the one-line section 0 answer; no board, no extra prompts."

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 44. Old ad books still teach words and shapes the newer rules changed

Fifteen small clashes with one cause. Each item shows Side A (the older line) first, then Side B (the newer line) after "Against", and which date wins.

1. "We think": `marketing/ads/RULES.md` line 38 (Part 0, 2026-10-05): "how much we think you'll qualify for based on where you're at right now." Against `.cursor/rules/copy-certainty.mdc` line 13 (2026-10-15): "This replaces the older". Newer wins. `marketing/ads/rules-data.mjs` line 250 prints the same old phrase.
2. "Most likely": `marketing/ads/RULES.md` line 42 (Part 0, 2026-10-05): "Say what's most likely based on the data." Against `.cursor/rules/copy-certainty.mdc` line 19 (2026-10-15), Never: "probably, likely, most likely, hopefully, chances are". Newer wins. `marketing/ads/rules-data.mjs` line 259 repeats it.
3. "Up to": `marketing/ads/RULES.md` line 119: ""Up to", with the conditions said out loud, is the only safe shape." Against your 2026-10-02 ask, `ops/workflows/ad-scripts-2026-10-02.md` line 63: "or "up to."" The ask is newer. `copy-certainty` does not list "up to".
4. "Optimize": `ops/workflows/ad-scripts-2026-10-02.md` line 115 (2026-10-02): "Never "optimize/optimized/optimizing"". Against `marketing/ads/RULES.md` line 37 (Part 0, 2026-10-05): "Say "credit optimization" or "optimize your credit."" Here the Part 0 line is newer, so the board loses.
5. Two close promises: `marketing/ads/RULES.md` line 529: "The wording may vary. Two promises may never be missing:" Against `memory/ad-rules-2026-10-02.md` line 18 (2026-10-02, later that day): "The RULES.md 3.6 close (soft pull + no obligation) is no longer required." The memory is newer. `ops/workflows/ad-scripts-2026-10-02.md` line 124 and `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 439 still require both.
6. Same close in every ad: `marketing/ads/RULES.md` line 659: "Same close as everywhere else." and `marketing/ads/ASSET-BANK.md` line 321: "Same close, every time." Against `.cursor/rules/ad-no-recycled-lines.mdc` line 13 (2026-10-15): "Rewrite any sentence that matches one of them." The rule is newer.
7. "Your number": `marketing/ads/VOICE.md` line 110: "Let's go find out your number." Against `marketing/ads/RULES.md` line 38 (Part 0, 2026-10-05): "Never say "your number" or "the number."" Part 0 is newer.
8. The denial hook: `marketing/ads/VOICE.md` line 81: "you didn't lose because of your" (Pair 1, "credit. You lost because nobody looked at your file"). Against `marketing/ads/RULES.md` line 52 (Part 0, 2026-10-05): "Never write "it's not X, it's Y."" Part 0 is newer. `marketing/ads/RULES.md` line 402 says three examples of this shape were cut on 2026-10-05.
9. "Not another ___" stems: `marketing/ads/ANGLE-GENERATOR.md` line 67: "Not another ___, but the first one that" Against your 2026-10-02 ask, `ops/workflows/ad-scripts-2026-10-02.md` line 36: "No "Not another ___, but..." openers." The ask is newer.
10. Bullets or paragraphs for a standard ad: `marketing/ads/RECIPES.md` line 9: "Standard ad (bullets by default)". Against `marketing/ads/RULES.md` line 90 (Part 0, 2026-10-05): "Teleprompter scripts are full, flowing sentences in paragraphs." `marketing/ads/RULES.md` line 97 says "Since Chris's 10/4 plan, standard ads default to the bullets style in Appendix B", and the file has no Appendix B. **This one needs your word:** bullets or paragraphs?
11. Notes ads: `marketing/ads/notes-green-screen.md` line 337 (2026-10-02): "plain text paragraphs with blank lines between them and no markdown" Against `marketing/ads/RULES.md` line 94 (Part 0, 2026-10-05): "Green screen and Notes ads are bullet cues." Part 0 is newer.
12. "Potentially seven figures": `marketing/ads/reference/locked-ads-2026-09.md` line 457: "Always "potentially seven figures", never a flat seven figures." Against `ops/workflows/ad-scripts-2026-10-02.md` line 110 (2026-10-02): "Never: could, could be worth, might, may, maybe, possibly, potentially, up to, or any other hedge." The board is newer.
13. "Frodo": `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 467 (2026-09-18): "At least one script uses the Frodo / skip-the-journey framing." Against `marketing/ads/RULES.md` line 78 (Part 0, 2026-10-05): "Don't use the "Frodo / skip the journey" framing." Part 0 is newer.
14. "Funding Snapshot": `marketing/ads/slo/SLO-CHAT-PROMPT.md` line 70 (2026-09-18): "Funding Snapshot — what their file supports today" Against `.cursor/rules/outcome-first-copy.mdc` line 20 (owner-banned 2026-09-29): ""Funding gap" and "Funding Snapshot"." The rule is newer.
15. "$10,000": `marketing/ads/RULES.md` line 125: "Not our offer. Do not sell it, do not say it." Against `marketing/ads/ascension/ascension-ads.md` line 128: "$10,000 once, no monthly base fee." Different offers. The never-say table needs a scope line.

**Why they fight.** The books were written before your newer calls and were never updated. It is the same question as #42: fix these lines now, or leave the books alone?

**What I would do.** Something else. Leave the books alone, as you ordered on 2026-10-02 (`memory/ad-rules-set-aside.md`), except two Part 0 lines: `marketing/ads/RULES.md` lines 38 and 42, and the same phrases in `marketing/ads/rules-data.mjs` lines 250 and 259. Part 0 stays live (#42), and `copy-certainty` already says it replaces those words. The other 13 are the fix list for your rebuild. Pick B and Phase 4 edits all 15 in about 10 files, and that lifts the "do not edit" order.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 45. Screenshot marks: red boxes or numbered circles?

**Side A.**

- `CLAUDE.md` line 610, section 8 (owner-set 2026-08-19): "Draw red boxes (and arrows when helpful) on the exact element being discussed."
- `CLAUDE.md` line 610: "Tooling: `ops/workflows/*-evidence/_mark-shots.mjs` + `_apply-marks.py`."
- `AGENTS.md` line 45: "red box around the exact issue and a short caption"

**Side B.**

- `.cursor/rules/audit-screenshot-markups.mdc` line 13 (owner law 2026-08-19, edited 2026-10-24): "Numbered red circles + yellow arrows"
- `.cursor/rules/audit-screenshot-markups.mdc` line 18: "None is on `main` as of 2026-10-24. Write a small marker script and save it in `scripts/`."

**Why they fight.** Two shapes for the marks on every screenshot you see. The rule also makes the yellow arrows required, and `CLAUDE.md` says arrows only "when helpful". `CLAUDE.md` names tools that are not on `main`.

**What I would do.** B. The rule is the detailed one, and it was updated 2026-10-24. `CLAUDE.md` line 610 points to it and drops the missing tool names. `docs/rules/RULES-INDEX.md` line 51 and the UI auditor skill already say circles.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 46. The ClickFunnels setup guide has Chris click ClickFunnels

**Side A.**

- `marketing/landing-pages/clickfunnels/CHRIS-DO-THIS-FIRST.md` line 23 (written 2026-09-08): "Go to: Contacts → Settings → Custom attributes"
- `marketing/landing-pages/clickfunnels/CHRIS-DO-THIS-FIRST.md` line 88: "Paste the whole thing into a Custom"

**Side B.**

- `.cursor/rules/chris-never-clickfunnels.mdc` line 12 (owner law 2026-09-21): "Chris never logs into ClickFunnels admin, the builder, or Developer Portal for routine funnel work."
- `.cursor/rules/chris-never-clickfunnels.mdc` line 19: "Tell him to map survey attributes or webhooks by hand when the API or an agent run can do it"
- `.cursor/rules/clickfunnels-html-api-push.mdc` line 12: "Never tell Chris to paste fragments into the builder as the default finish line."

**Why they fight.** The guide walks you through boxes, a survey setting, webhooks and a Custom HTML element in the ClickFunnels admin. The law says agents do all of it through the API.

**What I would do.** B (newest, 2026-09-21). Add a banner to the guide: "Old. Agents do this through the API (`chris-never-clickfunnels`)." Archive it when the agent run covers all four parts.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 47. "Zero Claude Code" against "both, for now"

**Side A.**

- `memory/command-center-goal.md` line 15 (your words, 2026-10-05): "Zero Claude Code, no exceptions"

**Side B.**

- `CLAUDE.md` line 469, section 3c (owner-set 2026-10-24): "Both, for now"
- `CLAUDE.md` line 467: "Chris drives ad, script and VSL generation from a Claude chat and that is fine."

**Why they fight.** The memory note and its index line say never run marketing from Claude Code. Section 3c says chat and skills are fine today, and the dashboard is the goal.

**What I would do.** B (newest, 2026-10-24). The memory note says "Zero Claude Code" is the goal, not today's rule.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 48. Many-file refactors: Opus does them, or Sonnet does the moves?

**Side A.**

- `CLAUDE.md` line 55, section 1: "Opus — anything where being wrong is expensive. Architecture, debugging something that already failed once, refactors across many files"

**Side B.**

- `memory/refactor-goal-reusable-base.md` line 14 (owner-set 2026-10-21): "Opus plans and checks slices, Sonnet does the moves."

**Why they fight.** Section 1 puts many-file refactors on Opus, and says to stop if the model is below what the work needs. The refactor note lets Sonnet do the moves. You said in this run that Opus is not really needed.

**What I would do.** B (newest, 2026-10-21). Section 1 says: Opus plans and checks the slices, Sonnet may do the moves.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 49. Batch work in a worktree inside the repo, but ship from outside it

**Side A.**

- `memory/batch-work-in-a-worktree.md` line 15 (2026-10-02): "run everything there."

**Side B.**

- `memory/ship-traps-2026-10-05.md` line 25 (2026-10-20): "Never ship from a folder nested inside the repo"
- `memory/non-nested-worktree-recipe.md` line 11 (2026-10-21): "must run from a worktree that is NOT inside"

**Why they fight.** The batch note puts the worktree at `.claude/worktrees/<batch>`, inside the repo, and says run everything there. Ship and `pulse:prove` must run from a folder outside the repo.

**What I would do.** Something else. Keep A for editing and tests. Add "except ship and `pulse:prove`, which run from a sibling folder (`non-nested-worktree-recipe`)" to the 10-02 note. Both newer notes say so.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## 50. A memory note still says 5th grade

**Side A.**

- `memory/deep-checks-live-data-not-fake-tests.md` line 12 (2026-10-14): "Talk at a 5th grade level in complete sentences when he asks."

**Side B.**

- `.cursor/rules/fourth-grade-english.mdc` line 8 (owner law 2026-10-05): "Talk to Chris at a 4th grade reading level."
- `.cursor/rules/fourth-grade-english.mdc` line 10 (owner-set 2026-10-24): "Ad scripts are 5th grade"

**Why they fight.** The rule says 4th grade replaced 5th for talking to you, and 5th grade is now for ad scripts only. The note is newer than the rule's first date and still names the old level. The note itself links to the 4th-grade note.

**What I would do.** B. Delete that one sentence from the memory note. The 4th-grade law says it wins where they differ.

Your pick: [ ] A  [ ] B  [ ] Something else: ____

---

## Checked and dropped

I checked all 167 reports against the committed files. No fight was dropped for a missing quote: every quote in a kept fight was found. Eight fights (13 reports) were dropped for other reasons.

1. **Old `.agents` version-control skill says "Never commits unless he asks."** (reports 13, 145.) Phase 2 replaced the old copy with the current text. The working copy no longer has that line. The current text, `.cursor/skills/fundhub-version-control/SKILL.md` line 8, says "Commits finished work locally in the same session."
2. **Old `.agents` auditor skill waits for Chris to approve the board.** (reports 16, 147.) Same reason. The working copy equals the current skill, which stops only for a missing owner decision.
3. **Old `.agents` fixer skill: Chris does one manual pass, and it flags COMPLIANCE.** (reports 17, 139, 146.) Same reason. The current skill has neither line.
4. **Old `.agents` ad-writer skill: 5th grade for Chris, and never run section 0.** (report 18.) Same reason. (The live section-0 clash in the current skill is #43.)

These four stay dropped only while the Phase 2 change stays. If Phase 2 is reverted, they come back.
5. **Video plan says "we never touch Meta".** (reports 72, 163.) The same file has a "Superseded" banner at line 11 that names exactly that point, so it is not a live fight.
6. **The 10-02 ad board says "never push (owner-set 2026-09-09)".** (report 98.) That board is for a finished batch. The rule it cites is in no current file I searched (`CLAUDE.md`, `AGENTS.md`, both rule folders, the memory notes). The same board's ask, line 73, says "push it".
7. **One-step coaching against "Chris never logs into tools".** (report 22.) The two rules fit together. One says how to coach when a click path cannot be avoided. The other says to avoid sending you there when an API exists.
8. **Landing-page briefs say "Chris pastes this whole file into a Claude chat".** (report 141.) `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md` line 5 says "Chris pastes this whole file into a Claude chat." `CLAUDE.md` line 27 is about workflow prompts. Section 3c (line 467) says driving ads and pages from a Claude chat "is fine". They do not collide.

---

## What happens after you pick

Phase 4 rewrites the losing line to match, in one place only, and archives the extra copy.

- **You pick A or B.** Phase 4 rewrites the lines on the other side to match your pick. It edits the real file in `.ai/rules/` or `.agents/skills/`, never a link. It moves any extra copy to `ops/archive/ai-instructions-2026-10-24/`.
- **You pick Something else and write it.** Phase 4 does what you wrote.
- **You tick nothing.** Phase 4 leaves both lines as they are and lists the fight again.
- **Memory notes** are outside the repo, and the lead edits them after your picks. These fights have a memory note on one side: #2, #4 to #6, #14, #19, #23, #25, #26, #29, #38, #42, #44, #47 to #50.
- **Code and hooks stay out of Phase 4.** `scripts/ship.mjs` (#5, #24), the hook text in `.claude/settings.json` and `.codex/hooks.json` (#18) and the ad-check hook (#42) go to the lead and Phase 7 as named fixes on the board.
- `npm run rules:check` must say OK before the lead commits.
