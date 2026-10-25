# Old skill copies

These are the extra copies of skills that were removed on 2026-10-24 (drift cleanup, phase 2). Each folder is a skill name.

- `agents/` is the old `.agents/skills/<name>/` folder. Most were older copies with Codex wording, and some were 12-line pointers.
- `claude/` is the old `.claude/skills/<name>/` real folder (only two skills had one).

The real skill now lives in `.agents/skills/<name>/`. `.cursor/skills/<name>` and `.claude/skills/<name>` are links to it.

Nothing reads this folder. The differences between the copies are written down in `ops/workflows/drift-cleanup-2026-10-24/phase-2-layout.md`.
