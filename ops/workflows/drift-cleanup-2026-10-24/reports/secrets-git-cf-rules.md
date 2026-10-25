# Secrets, git, and ClickFunnels rules

Date: 2026-10-24. Branch `drift-cleanup`. No commit.

## Files changed

- `.ai/rules/secrets-env-law.md` — Folded env-full-copies (call 28), Never remove a key (call 1 carve-out, owner-set 2026-09-17 and 2026-10-04), and Setting variables (call 24). Replaced the dictator, chat-paste, and mask repeats with pointers. `all contexts` is now `--context production --context deploy-preview --context branch-deploy`.
- `.ai/rules/show-secrets-when-chris-asks.md` — Dictator mode counts as the ask (first set 2026-09-25, restated 2026-10-04). Commit and default lines now point at secrets-env-law.
- `.ai/rules/agents-run-ops-not-chris.md` — Push policy points at github-push (repo is public, owner-set 2026-10-24). The ask-Chris list points at finish-the-answer, and the 2026-10-24 test-row date stays.
- `.ai/rules/github-push.md` — Added "Commit locally, every session (owner-set 2026-09-08)". The never-commit sentence points at secrets-env-law.
- `.ai/rules/repo-hygiene-vc-router.md` — Commit-locally cell points at github-push (date 2026-09-08 kept). The secrets bullet points at secrets-env-law.
- `.ai/rules/chris-never-clickfunnels.md` — Took the ClickFunnels HTML push law (merge M5): auth order, manual-paste exception, live URLs, tracking, the booking calendar, and the $297 funnel. Description updated. Print ban points at secrets-env-law (call 11).
- `.ai/rules/clickfunnels-developers-docs.md` — Builder-paste bullet points at chris-never-clickfunnels. The manual-paste exception and the GA date 2026-09-18 moved with it.
- `.ai/rules/chris-never-submagic.md` — Deleted the repeated ClickFunnels sentence. Print ban points at secrets-env-law (call 11).

## Files archived

Moved with `git mv`. Links removed with `git rm`. Same relative path under `ops/archive/ai-instructions-2026-10-24/`.

- `.ai/rules/env-full-copies-never-masked.md` — Merged into secrets-env-law (M4, call 28). Links removed: `.cursor/rules/env-full-copies-never-masked.mdc`, `.claude/rules/env-full-copies-never-masked.md`.
- `.ai/rules/clickfunnels-html-api-push.md` — Merged into chris-never-clickfunnels (M5). Links removed: `.cursor/rules/clickfunnels-html-api-push.mdc`, `.claude/rules/clickfunnels-html-api-push.md`.
- `.ai/rules/ui-standards.md` — Call 20. Cursor-only, no audience. Link removed: `.cursor/rules/ui-standards.mdc`. `.claude/rules/ui-standards.md` was not in the tree (this rule never had a Claude link). The screen laws already live in `docs/rules/UI-STANDARDS.md` (Astra contract owner-set 2026-10-20, the 40px / 11px floors, no new design system, flag a conflict and do not reopen it).

Cut sentences are in `ops/archive/ai-instructions-2026-10-24/removed-lines/.ai__rules__<name>.md.md`.

## Handoff

Do not treat these as done. They are not my files.

- `docs/rules/RULES-INDEX.md` line 85: change the `secrets-env-law` row to `` `secrets-env-law` (both homes): Env secrets are gitignored; read .env; never mask a copy; never remove or rotate a working key; batch env vars and ship once. ``
- `docs/rules/RULES-INDEX.md` line 87: delete the `env-full-copies-never-masked` row.
- `docs/rules/RULES-INDEX.md` line 122: delete the `ui-standards` row.
- `docs/rules/RULES-INDEX.md` line 123: delete the `clickfunnels-html-api-push` row.
- `docs/rules/RULES-INDEX.md` line 124: change the `chris-never-clickfunnels` row to `` `chris-never-clickfunnels` (both homes): Chris never logs into ClickFunnels admin; agents push funnel HTML through the Custom HTML Pages API and prove it live. ``
- `CLAUDE.md` line 206: it still names `.claude/rules/clickfunnels-html-api-push.md`. Retarget that name to `.ai/rules/chris-never-clickfunnels.md`. This is the one drift-check line that names a file I archived.
- `CLAUDE.md` line 258: `Same law: secrets-env-law, env-full-copies-never-masked.` Drop `env-full-copies-never-masked`. The law is `secrets-env-law`.
- `scripts/rules-drift-allow.json` `cursorOnlyRules.ui-standards`: remove that entry. The rule is archived (stale plan R2). I did not edit `scripts/`.
- `.agents/skills/fundhub-ui-auditor/SKILL.md` line 41: change `Chris names fixes; ui-standards.mdc governs the rebuild.` to `Chris names fixes; docs/rules/UI-STANDARDS.md governs the rebuild.`
- Unique sentence from the archived ui-standards rule, if the skill owner wants it (the decision named no fold file, and the standards body is already in `docs/rules/UI-STANDARDS.md`): `UI audits use the fundhub-ui-auditor skill and stay read-only unless the repair is already authorized. This pointer does not grant new product, release or customer-action authority.`
- `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md`: D24 delete the `/funding-book-call` table row. D25 delete the `$297 slo-02-booking` table row. D223 is on the SOP, not this skill. The skill's other pointer swaps are D22, D23, D26, D27, and D28 in the dedupe plan. I do not own `.agents/skills/`.
- `docs/sops/clickfunnels-custom-html-push.md` line 8: delete `Manual paste is fallback only if API auth is truly missing.` and write `Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - if the API key is missing, report the env name and stop; never ask Chris to paste.`
- `docs/sops/clickfunnels-custom-html-push.md` lines 117-119: replace the three bullets with `- Skill: `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` (linked at `.cursor/skills/` and `.claude/skills/`).` and `- Rule: `.ai/rules/chris-never-clickfunnels.md`.`
- `marketing/landing-pages/clickfunnels/CHRIS-DO-THIS-FIRST.md` (call 46): add the banner `Old. Agents do this through the API (chris-never-clickfunnels).` Keep the file.

## Skipped

- `.ai/rules/github-ships-main.md` — No dedupe or stale edit. Call 9's winning line is already in this file. The named edit for call 9 is `no-remote-control`, which is not my file.
- `.ai/rules/secrets-env-law.md` still says `` `npm run ship` from cloud `` inside the Mac-or-cloud bullet. Plan D169 only replaced `all contexts`. Call 9 does not name this file.
- `.ai/rules/github-push.md` "Do not" still says `Print or commit GITHUB_TOKEN`. No plan line named that bullet. The credentials paragraph above it already says paste only when Chris asks.
- `.agents/skills/clickfunnels-developers-docs/SKILL.md` — Plan D1 is already the pointer. I do not own skills, so I left it.
- `.agents/skills/fundhub-fixer/SKILL.md` — Call 11's paste-when-asked pointer is already on the secrets lines. Not my file.
- `scripts/ship.mjs` — Calls 5 and 24. Not mine.
- `CLAUDE.md`, `AGENTS.md`, `docs/rules/RULES-INDEX.md`, `PROGRESS.md` — Not mine.

## Drift check

`node scripts/rules-drift-check.mjs` exited 1 (17 problems). The only line that names a file I own is:

```
  CLAUDE.md:206
    Names ".claude/rules/clickfunnels-html-api-push.md" but it does not exist.
    Fix: Fix the path to a real file, or remove the line if the rule is gone.
```

That retarget is in Handoff. I did not edit CLAUDE.md. The other 16 problems do not name my files.
