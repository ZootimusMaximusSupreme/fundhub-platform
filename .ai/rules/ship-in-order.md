---
description: Ship finished changes through the ordered PR chain.
alwaysApply: true
---

# Ship changes in order

**Owner rule, 2026-10-31.** When a change is finished and checked, run `npm run ship-change -- --message "Short change name" --owner-lane team-name -- path/to/file1 path/to/file2` from its own branch. Name every file in that change so customer data and unrelated work stay out of the commit. The owner lane matches the release gate in `scripts/release-control.mjs`. The command commits those files, archives their exact head as `archive/<branch-name>` before push, opens its pull request, and places it after Chris's prior open ordered change. The first ready pull request waits for required checks and squash auto-merge; later changes wait in chain order. The restack Action updates the archive tag before it pushes a rebased child.

Never merge out of chain order. Never stack a branch or retarget a pull request by hand. If the parent merge or a rebase conflicts, leave the affected pull request open and tell Chris which file needs a decision. Do not force a merge or call a queued change live. Verify the `ship.yml` run and live result after each main merge.

GitHub's native merge queue is unavailable while this repository is owned by a personal account. If the owner moves it to an organization, require the native queue on `main`; the CI workflow already supports `merge_group`. Until then, the branch chain and auto-merge move one PR at a time.

Run `npm run preflight` first and resolve shared files. The ordered shipping command does not replace lint, tests, `rules:check`, or the branch's product proof.
If the command stops after committing, fix the reported issue and rerun with `--resume --message "Same change name" --owner-lane team-name`; it will reuse the clean commit.
