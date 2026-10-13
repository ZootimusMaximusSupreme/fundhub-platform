# Codex instruction migration — 2026-10-12

Owner request: make the repository's working rules available to Codex, using the file Codex reads automatically.

- Official OpenAI documentation identifies `AGENTS.md` as Codex's repository instruction file.
- `CLAUDE.md` remains Claude's detailed runbook. Shared high-value rules are now in root `AGENTS.md`; Claude points back to it.
- The shared split-and-stop start rule now appears in `AGENTS.md`. Claude-only model and tool instructions stay in `CLAUDE.md`.
- Proof: reviewed both diffs and ran `git diff --check`. No app code changed for this migration.
