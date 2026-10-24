# Phase 6: old worktrees and side copies (list only)

Checked on Saturday 2026-10-24 at 14:53 Arizona time, against `origin/main` at `c54f936a4`. **List only. I removed nothing, pruned nothing and changed nothing.** The data file is `phase-6-old-copies.tsv` in this folder, one row per worktree.

In the tables, `.claude/worktrees/x` means `/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/x`, `.codex/worktrees/x` means `/Users/chrisstanbridge/Developer/fundhub-platform/.codex/worktrees/x`, and `~` means `/Users/chrisstanbridge`. Full paths are in the data file and in the command list.

## The answer

I checked **96 worktrees**. That is every worktree except drift-cleanup, and it counts the main folder. **64 are REMOVE-SAFE, 23 are KEEP-WORK, and 9 are ASK.** The 64 REMOVE-SAFE ones take up about **41.3 GB** of disk (measured with `du`). One of them is only a leftover record, because its folder is already gone. There are also **4 side copies** that are not worktrees. The commands that would remove the REMOVE-SAFE ones are at the bottom, marked **NOT RUN. Waiting for Chris's yes.**

Words used here:

- **Worktree:** an extra folder that git makes, so one branch can be worked on beside the others.
- **Inside main:** every commit of the branch is already part of main. Nothing is lost if the folder goes.
- **Unsaved file:** a file that was changed or added in the folder and is not committed yet.
- **Link:** a shortcut file that points at another file. Removing the link leaves the real file alone.
- **Detached:** the folder is not tied to a branch name.

What the numbers mean:

- **Every REMOVE-SAFE branch is already inside main.** No commit is lost if they go. I re-tested all 64 at the end: clean, nothing unsaved, no commits of their own, idle for more than a day, no program running inside. Zero problems.
- **They carry old rules.** Only 1 of 95 folders has the same CLAUDE.md as `origin/main` (`.claude/worktrees/rules-guard`). The 63 REMOVE-SAFE folders hold a CLAUDE.md of 592 to 620 lines. Today's has 769. They sit 131 to 1,135 commits behind main and have been idle 2.2 to 9.6 days.
- **3 folders hold commits that are not on GitHub** (6 commits, only on this Mac): `ad12-anim`, `ad9-anim`, `agent-ad757cb511b23a0f7`. They stay.
- **The finish-853 folders look big but are merged.** 27 `fin-*` folders are REMOVE-SAFE. Their commits went into main on Oct 15, through the `fin/integrate` merges.

Two items were not what they first looked like:

- `/Users/chrisstanbridge/fundhub-ship` and `.codex/worktrees/heartbeat-money-workspace` are **registered worktrees**, not loose copies. They are in the main tables (KEEP-WORK and ASK).
- `ops/workflows/AGENTS-local-backup-2026-10-12.md` exists only in the main folder, and git does not track it there. It is not in `origin/main`. Its text is saved in git under two special refs (see Side copies).

## Live work from other sessions. Do not touch.

These hold work from sessions that are running now, or ran in the last day. Numbers are from 14:53 and keep changing.

| Folder | Branch | Sign that it is live |
|---|---|---|
| `~/Developer/fundhub-platform` (**the main folder**) | `codex/two-ios-apps-launch` | 189 unsaved files (edits to CLAUDE.md and AGENTS.md, 3 new rule files). 3 Claude sessions run here. Never removable. |
| `~/Developer/fundhub-giovanni-banks-live` | `giovanni-banks-live` | files changed 19 min ago; 1 unsaved file. Last commit: "Fix the new bank rows so the ship can save them." |
| `~/Developer/fundhub-weekend-launch-plan` | `weekend-launch-plan` | files changed 19 min ago; 4 commits not on main. Last commit: "docs: record the live test of Giovanni's bank list" |
| `.claude/worktrees/ad9-anim` | `claude/ad9-animations` | files changed 2.0 h ago; 3 commits not on main. Last commit: "ad9-anim: animations placed behind him, nothing over his head; sound -14…" |
| `.claude/worktrees/ad12-anim` | `claude/ad12-animations` | files changed 2.3 h ago; 2 commits not on main. Last commit: "ad12-anim: animations placed behind him, nothing over his head; sound -14…" |
| `.claude/worktrees/rules-guard` | `claude/cta-optional` | files changed 2.3 h ago. Last commit: "Rule: CTA only when it fits, never big by default (owner 2026-10-24)" |
| `.claude/worktrees/no-echo-rule` | `claude/anim-idea-behind` | files changed 2.4 h ago. Last commit: "Slot-machine idea: full width behind his head, never over his face (owner…" |
| `.claude/worktrees/rules-answers` | `claude/rules-owner-answers` | files changed 2.7 h ago. Last commit: "Merge remote-tracking branch 'origin/main' into claude/rules-owner-answers" |
| `.claude/worktrees/rules-drift` | `claude/rules-drift-fix` | files changed 3.0 h ago. Last commit: "Board: rules drift fix 2026-10-24 (fixed, waiting, Chris decides)" |
| `.claude/worktrees/vsl-anim` | `claude/vsl-animations` | files changed 3.5 h ago; 32 unsaved files. Last commit: "Direct Book VSL 1: BookCall shows only his words (no picked day/time chip,…" |

Also unsaved work, but older than a day: `~/.codex/worktrees/cortana-fee-invoices/fundhub-platform` (24 files); `~/.codex/worktrees/dashboard-ux-polish/fundhub-platform` (3 files); `~/Developer/fundhub-invite-links` (28 files, edits to CLAUDE.md and AGENTS.md, 2 new rule files); `.claude/worktrees/fin-b11` (14 files); `.claude/worktrees/fin-b22` (1 file); `.claude/worktrees/fin-b26` (13 files); `.claude/worktrees/portal-phone-signin` (4 files). The ship folder `~/fundhub-ship` is live too: ships go out only from there.

## KEEP-WORK (23)

Rule used: the folder has unsaved files, or commits that are not on main, or files that changed in the last 24 hours. Top rows are the most live.

| Folder | Branch | Why |
|---|---|---|
| `~/Developer/fundhub-platform` | `codex/two-ios-apps-launch` | MAIN FOLDER, never removable. 189 unsaved files (edits to CLAUDE.md and AGENTS.md, 3 new rule files); 64 commits not on main (all on GitHub); 3 Claude sessions run here |
| `~/Developer/fundhub-giovanni-banks-live` | `giovanni-banks-live` | 1 unsaved file; files changed 19 min ago |
| `~/Developer/fundhub-weekend-launch-plan` | `weekend-launch-plan` | 4 commits not on main (on GitHub); files changed 19 min ago |
| `.claude/worktrees/ad9-anim` | `claude/ad9-animations` | 3 commits not on main (only on this Mac); files changed 2.0 h ago |
| `.claude/worktrees/ad12-anim` | `claude/ad12-animations` | 2 commits not on main (only on this Mac); files changed 2.3 h ago |
| `.claude/worktrees/rules-guard` | `claude/cta-optional` | files changed 2.3 h ago |
| `.claude/worktrees/no-echo-rule` | `claude/anim-idea-behind` | files changed 2.4 h ago |
| `.claude/worktrees/rules-answers` | `claude/rules-owner-answers` | files changed 2.7 h ago |
| `.claude/worktrees/rules-drift` | `claude/rules-drift-fix` | files changed 3.0 h ago |
| `.claude/worktrees/vsl-anim` | `claude/vsl-animations` | 32 unsaved files (a skill edit); files changed 3.5 h ago |
| `~/Developer/fundhub-invite-links` | `claude/invite-links-never-expire-2026-10-21` | 28 unsaved files (edits to CLAUDE.md and AGENTS.md, 2 new rule files) |
| `.claude/worktrees/portal-phone-signin` | `claude/portal-phone-signin` | 4 unsaved files |
| `~/.codex/worktrees/cortana-fee-invoices/fundhub-platform` | `claude/cortana-weighted-feed` | 24 unsaved files; ignored evidence files not in git |
| `~/.codex/worktrees/dashboard-ux-polish/fundhub-platform` | `codex/crm-astra-phone-stability` | 3 unsaved files; ignored evidence files not in git |
| `.claude/worktrees/fin-b11` | `fin/b11` | 14 unsaved files |
| `.claude/worktrees/fin-b26` | `fin/b26` | 13 unsaved files |
| `.claude/worktrees/fin-b22` | `fin/b22` | 1 unsaved file |
| `.claude/worktrees/agent-ad757cb511b23a0f7` | `worktree-agent-ad757cb511b23a0f7` | 1 commit not on main (only on this Mac) |
| `.claude/worktrees/portal-phone-welcome` | `claude/portal-phone-welcome` | 2 commits not on main (on GitHub) |
| `.claude/worktrees/mac-bridge` | `feat/mac-bridge-v1` | 15 commits not on main (on GitHub) |
| `.claude/worktrees/display-lane-time` | `fix/display-lane-time` | 2 commits not on main (on GitHub) |
| `.claude/worktrees/lp-r15` | `lp/r15-csm-picker-no-demo` | 1 commit not on main (on GitHub) |
| `~/fundhub-ship` | `main` | live ship folder (ships go out only from here); 117 commits behind main; own .env |

## ASK (9)

I cannot tell for these. Each row says what I am missing. A yes from Chris means "safe to remove" and the row moves to REMOVE-SAFE. A no moves it to KEEP-WORK.

| Folder | Branch | Why I cannot tell | What I need |
|---|---|---|---|
| `.claude/worktrees/blueprint-timelapse` | `demo/blueprint-timelapse` | The 1 commit is not in main by id, but main already has all 7 files it changed, exactly. It is also on GitHub as `origin/demo/blueprint-timelapse`. | Say yes: treat it as merged. |
| `.claude/worktrees/brief-whole-suite` | `fix/brief-whole-suite` | The 1 commit is not in main by id, but main already has all 2 files it changed, exactly. It is also on GitHub as `origin/fix/brief-whole-suite`. | Say yes: treat it as merged. |
| `.claude/worktrees/exciting-ramanujan-40ff0e` | `detached` | It has its own `.codex/config.toml` (1,060 bytes, made Oct 20 16:18). It is the same size as the main folder's copy but a different date. I did not open it. | Is this file a throwaway copy? |
| `.claude/worktrees/funny-sinoussi-765e2b` | `detached` | 15 raw screenshots (3.5 MB, PNG) and `shot-marks.json` in `ops/workflows/build-evidence/bank-outreach-auto/`. Git ignores them. The main folder does not have them. | Are these proof files still needed? |
| `.claude/worktrees/heartbeat-flow-read-proof` | `codex/heartbeat-flow-read-proof` | The 1 commit is not in main by id. `git cherry` finds the same patch in main. 6 of its 8 files have changed again since. It is also on GitHub as `origin/codex/heartbeat-flow-read-proof`. | Say yes: treat it as merged. |
| `.claude/worktrees/heartbeat-route-proofs` | `codex/heartbeat-route-proofs` | The 1 commit is not in main by id. `git cherry` finds the same patch in main. 4 of its 7 files have changed again since. It is also on GitHub as `origin/codex/heartbeat-route-proofs`. | Say yes: treat it as merged. |
| `.claude/worktrees/lp-r06` | `lp/r06-instant-watch-email` | It has its own real `credentials/notion-scrape` folder: a Chrome profile plus 2 test files, 2,223 files, 69 MB. 1,916 of its file names are not in the main folder's copy. I did not open it. | Is this Notion scrape profile still needed? |
| `.codex/worktrees/heartbeat-money-workspace` | `codex/heartbeat-money-workspace` | The 1 commit is not in main by id. `git cherry` finds the same patch in main. 1 of its 10 files has changed again since. It is also on GitHub as `origin/codex/heartbeat-money-workspace`. [Codex app folder] | Say yes: treat it as merged. |
| `~/.codex/worktrees/blueprint-offer-core/fundhub-platform` | `claude/blueprint-live-state-2026-10-20` | 2 ignored proof screenshots (228 KB, Whop settings) in `ops/workflows/build-evidence/blueprint-provider-setup-2026-10-20/`. Not in git. Not in the main folder. [Codex app folder] | Are these proof files still needed? |

## REMOVE-SAFE (64)

Rule used: the folder is clean, its branch is already inside `origin/main` (or it has no commits of its own), nothing changed in the last 24 hours, and no program runs inside it. 63 real folders (41.3 GB) and 1 leftover record whose folder is gone.

Groups: 27 `fin-*`, 8 `lp-*`, 18 `agent-*`, and 11 others.

Three things I checked on purpose:

- **Links, not copies.** 11 of these folders have a `.env` (one also has a `credentials` entry). Every one is a **symbolic link to the main folder's file**. I checked with `lstat` and did not open any of them. Git removes the link and leaves the main folder's file alone.
- **Throwaway files only.** The only other ignored files in these folders are `test-results/` and `.netlify/`. Nothing else lives only here.
- **Codex app folders.** `~/.codex/worktrees/bank-outreach-release/fundhub-platform` is in the Codex app's own place. Removing it loses nothing. The app's thread list can still show the name.

| Folder | Branch | MB | CLAUDE.md lines | Why |
|---|---|---:|---:|---|
| `.claude/worktrees/agent-a01703f5614030655` | `worktree-agent-a01703f5614030655` | 944 | 620 | branch is inside main; clean; idle 3.7 days; .env link points to the main folder |
| `.claude/worktrees/agent-a17995795ee2268c4` | `worktree-agent-a17995795ee2268c4` | 654 | 620 | branch is inside main; clean; idle 3.8 days |
| `.claude/worktrees/agent-a34b1240951cf50fe` | `worktree-agent-a34b1240951cf50fe` | 653 | 620 | branch is inside main; clean; idle 3.8 days |
| `.claude/worktrees/agent-a38656c5ee90545c4` | `claude/meta-spend-zero-fix-2026-10-21` | 949 | 620 | branch is inside main; clean; idle 3.5 days; .env link points to the main folder |
| `.claude/worktrees/agent-a430378483f13f158` | `worktree-agent-a430378483f13f158` | 950 | 620 | branch is inside main; clean; idle 3.6 days; .env link points to the main folder |
| `.claude/worktrees/agent-a5a1a474491b7952c` | `worktree-agent-a5a1a474491b7952c` | 655 | 620 | branch is inside main; clean; idle 3.7 days; .env link points to the main folder |
| `.claude/worktrees/agent-a6b4f4fbc2fdbfa25` | `worktree-agent-a6b4f4fbc2fdbfa25` | 944 | 620 | branch is inside main; clean; idle 3.6 days; .env link points to the main folder |
| `.claude/worktrees/agent-a7c9b4060b123055c` | `worktree-agent-a7c9b4060b123055c` | 653 | 620 | branch is inside main; clean; idle 3.8 days |
| `.claude/worktrees/agent-a8eb6cc014624d64b` | `worktree-agent-a8eb6cc014624d64b` | 653 | 620 | branch is inside main; clean; idle 3.9 days |
| `.claude/worktrees/agent-a9a8a03a200489e9d` | `worktree-agent-a9a8a03a200489e9d` | 945 | 620 | branch is inside main; clean; idle 3.5 days; .env link points to the main folder |
| `.claude/worktrees/agent-aa41b9e52f6140a01` | `worktree-agent-aa41b9e52f6140a01` | 654 | 620 | branch is inside main; clean; idle 3.8 days |
| `.claude/worktrees/agent-aa5838507093130b0` | `worktree-agent-aa5838507093130b0` | 943 | 620 | branch is inside main; clean; idle 3.7 days |
| `.claude/worktrees/agent-ac2f95f2d12ac1b42` | `worktree-agent-ac2f95f2d12ac1b42` | 944 | 620 | branch is inside main; clean; idle 3.6 days; .env link points to the main folder |
| `.claude/worktrees/agent-ad366197c43f53e1d` | `worktree-agent-ad366197c43f53e1d` | 654 | 620 | branch is inside main; clean; idle 3.8 days |
| `.claude/worktrees/agent-adb1acc7f1d093bd8` | `worktree-agent-adb1acc7f1d093bd8` | 944 | 620 | branch is inside main; clean; idle 3.7 days; .env link points to the main folder |
| `.claude/worktrees/agent-af3357f8493595756` | `worktree-agent-af3357f8493595756` | 944 | 620 | branch is inside main; clean; idle 3.7 days; .env link points to the main folder |
| `.claude/worktrees/agent-afa48accd3f453029` | `worktree-agent-afa48accd3f453029` | 653 | 620 | branch is inside main; clean; idle 3.9 days |
| `.claude/worktrees/agent-afcde7fea54e12d1f` | `worktree-agent-afcde7fea54e12d1f` | 653 | 620 | branch is inside main; clean; idle 3.9 days |
| `.claude/worktrees/blueprint-step-words` | `fix/blueprint-step-words` | 945 | 620 | branch is inside main; clean; idle 3.6 days |
| `.claude/worktrees/fin-b01` | `fin/b01` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b02` | `fin/b02` | 572 | 592 | branch is inside main; clean; idle 9.4 days |
| `.claude/worktrees/fin-b03` | `fin/b03` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b03-chk20` | `detached` | 572 | 592 | detached head is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fin-b04` | `fin/b04` | 573 | 592 | branch is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fin-b05` | `fin/b05` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b06` | `fin/b06` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b07` | `fin/b07` | 573 | 592 | branch is inside main; clean; idle 9.4 days |
| `.claude/worktrees/fin-b08` | `fin/b08` | 573 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b09` | `fin/b09` | 572 | 592 | branch is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fin-b10` | `fin/b10` | 572 | 592 | branch is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fin-b12` | `fin/b12` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b13` | `fin/b13` | 572 | 592 | branch is inside main; clean; idle 9.4 days |
| `.claude/worktrees/fin-b14` | `fin/b14` | 582 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b14-chk11` | `detached` | 591 | 592 | detached head is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fin-b15` | `fin/b15` | 572 | 592 | branch is inside main; clean; idle 9.4 days |
| `.claude/worktrees/fin-b16` | `fin/b16` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b16-chk10` | `detached` | 572 | 592 | detached head is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fin-b17` | `fin/b17` | 572 | 592 | branch is inside main; clean; idle 9.5 days |
| `.claude/worktrees/fin-b18` | `fin/b18` | 572 | 592 | branch is inside main; clean; idle 9.4 days |
| `.claude/worktrees/fin-b19` | `fin/b19` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b20` | `fin/b20` | 572 | 592 | branch is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fin-b21` | `fin/b21` | 572 | 592 | branch is inside main; clean; idle 9.4 days |
| `.claude/worktrees/fin-b23` | `fin/b23` | 572 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b24` | `fin/b24` | 573 | 592 | branch is inside main; clean; idle 9.3 days |
| `.claude/worktrees/fin-b25` | `fin/b25` | 579 | 592 | branch is inside main; clean; idle 9.4 days |
| `.claude/worktrees/fin-integrate` | `fin/integrate` | 582 | 596 | branch is inside main; clean; idle 9.2 days |
| `.claude/worktrees/fix-red-tests` | `fix/red-tests` | 582 | 596 | branch is inside main; clean; idle 9.1 days |
| `.claude/worktrees/hungry-clarke-3e9917` | `detached` | 961 | 620 | detached head is inside main; clean; idle 2.1 days |
| `.claude/worktrees/lp-r03-ds-02` | `lp/r03-ds-02` | 572 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/lp-r07-fos-01` | `lp/r07-fos-01` | 573 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/lp-r18-cb-11` | `lp/r18-cb-11` | 572 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/lp-r19-fos-02` | `lp/r19-fos-02` | 572 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/lp-r20-cp-02` | `lp/r20-cp-02-payments-usd` | 572 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/lp-r22-cp-07` | `lp/r22-cp-07` | 572 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/lp-r23-cp06` | `lp/r23-cp06-upload-heic` | 572 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/lp-r24-fos-04` | `lp/r24-fos-04` | 572 | 592 | branch is inside main; clean; idle 9.6 days |
| `.claude/worktrees/money-hourly-beats` | `claude/money-hourly-beats-2026-10-21` | 660 | 620 | branch is inside main; clean; idle 3.3 days; .env link points to the main folder |
| `.claude/worktrees/repair-fee-upfront` | `claude/repair-fee-upfront-2026-10-20` | 658 | 620 | branch is inside main; clean; idle 3.8 days |
| `.claude/worktrees/restore-templates` | `claude/restore-templates-2026-10-20` | 654 | 620 | branch is inside main; clean; idle 3.7 days |
| `.claude/worktrees/set-a-integration` | `claude/set-a-fix-2026-10-20` | 653 | 620 | branch is inside main; clean; idle 3.8 days |
| `.claude/worktrees/ship-main` | `detached` | 1,119 | 620 | detached head is inside main; clean; idle 4.0 days; .env and credentials links point to the main folder |
| `/private/tmp/…/scratchpad/drift/main` | `detached` | 0 | gone | folder is already gone; only a leftover record; head is inside main |
| `~/.codex/worktrees/bank-outreach-release/fundhub-platform` | `codex/bank-outreach-release` | 653 | 620 | branch is inside main; clean; idle 4.0 days [Codex app folder] |
| `~/Developer/fundhub-applinks-speed` | `claude/apply-links-speed-2026-10-21` | 950 | 620 | branch is inside main; clean; idle 3.1 days |

Total: about 41.3 GB (42,303 MB). `du` adds up each folder's own files. The Mac can share disk space between copies, so the space you get back can be smaller.

## Side copies (not worktrees)

**4 items.** Each row says what it is, how big, when it last changed, and whether it holds work that exists nowhere else.

| Item | What it is | Size | Last change | Work found nowhere else? | Bucket |
|---|---|---:|---|---|---|
| `.claude/worktrees/slo-197` | An old full checkout from Oct 4. Its `.git` file points at `/sessions/rcw-…/mnt/fundhub-platform/…`, a path from a sandbox that does not exist on this Mac. So git does not know this folder. It has its own CLAUDE.md (44,373 bytes, old). | 492 MB | Oct 4, 09:56 | **No.** I hashed all 4,647 files (no `node_modules` inside). Every one is in git history, reachable from a ref in this repo. The branch was merged into main (commit `332903093`, "Merge slo-197"). No program runs inside it. | **REMOVE-SAFE.** Git cannot remove it. Move it to the Trash. |
| `.claude/worktrees/blueprint-intended-ai-csm.patch` | A loose patch file. It changes 3 lines of one file: `docs/journeys/capital-blueprint-intended.md`. | 5 KB | Oct 20, 18:14 | **No.** Git says the change is already in main: the reverse patch applies cleanly to today's tree, and the forward patch does not. | **REMOVE-SAFE.** Move it to the Trash. |
| `ops/workflows/AGENTS-local-backup-2026-10-12.md` (main folder) | A copy of the old long AGENTS.md. It has 590 lines. Today's AGENTS.md has 67. Git does not track it in the main folder. | 48,946 bytes | Oct 11, 11:41 | **Saved in git, under local refs. Not on any GitHub branch.** The same text is in commits `c3c858534` and `f0be91656`, held by the refs `refs/bundles/root-2026-10-21` and `refs/bundles/night-root-checkout`. | **ASK.** It sits in the other session's folder. The Phase 4 plan is to archive it. |
| `credentials/hormozi-kb-work/whisper.cpp/AGENTS.md` (main folder) | An AGENTS.md inside a folder named `whisper.cpp`, under the gitignored `credentials/` folder. It is not a Fundhub rule file. I saw the name only and did not open it. | 6,192 bytes | Oct 5, 13:40 | Not ours. It comes with that folder. | **KEEP-WORK.** Leave it. |

Two more items were named as side copies. Git lists both as real worktrees, so they are counted in the main tables, not here:

- `/Users/chrisstanbridge/fundhub-ship`: **KEEP-WORK.** The launch notes say the coordinator ships only from this folder. It is on `main`, 117 commits behind, so its CLAUDE.md is old. It has its own real `.env` (8,006 bytes, Oct 20), different from the main folder's (8,980 bytes).
- `.codex/worktrees/heartbeat-money-workspace`: **ASK.** See the ASK table.

Also checked: `/Users/chrisstanbridge/Developer/fundhub-broll-backup-2026-10-05` is 1.7 GB of B-roll video from Oct 2. It has no CLAUDE.md or AGENTS.md, so it is not on these lists. I searched `/Users/chrisstanbridge/Developer/fundhub-*` for CLAUDE.md and AGENTS.md files (skipping `node_modules` and the registered worktree folders, which the tables above cover). The four items above are all I found beyond the root files of each worktree.

## Commands that WOULD remove the REMOVE-SAFE ones. NOT RUN. Waiting for Chris's yes.

Run them from the drift-cleanup folder. It is cut from today's main, so `git branch -d` can check each branch against main. Do not add `--force`. `git worktree remove` refuses on its own if a folder has any unsaved file, and `git branch -d` refuses on its own if a branch is not merged. If either refuses, stop and tell me.

```bash
# NOT RUN. Waiting for Chris's yes.
cd /Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/drift-cleanup

# A. The leftover record whose folder is already gone
git worktree prune --verbose

# B. 63 folders: take the folder away, then delete its branch (detached heads: folder only)
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a01703f5614030655' && git branch -d 'worktree-agent-a01703f5614030655'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a17995795ee2268c4' && git branch -d 'worktree-agent-a17995795ee2268c4'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a34b1240951cf50fe' && git branch -d 'worktree-agent-a34b1240951cf50fe'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a38656c5ee90545c4' && git branch -d 'claude/meta-spend-zero-fix-2026-10-21'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a430378483f13f158' && git branch -d 'worktree-agent-a430378483f13f158'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a5a1a474491b7952c' && git branch -d 'worktree-agent-a5a1a474491b7952c'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a6b4f4fbc2fdbfa25' && git branch -d 'worktree-agent-a6b4f4fbc2fdbfa25'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a7c9b4060b123055c' && git branch -d 'worktree-agent-a7c9b4060b123055c'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a8eb6cc014624d64b' && git branch -d 'worktree-agent-a8eb6cc014624d64b'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-a9a8a03a200489e9d' && git branch -d 'worktree-agent-a9a8a03a200489e9d'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-aa41b9e52f6140a01' && git branch -d 'worktree-agent-aa41b9e52f6140a01'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-aa5838507093130b0' && git branch -d 'worktree-agent-aa5838507093130b0'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-ac2f95f2d12ac1b42' && git branch -d 'worktree-agent-ac2f95f2d12ac1b42'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-ad366197c43f53e1d' && git branch -d 'worktree-agent-ad366197c43f53e1d'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-adb1acc7f1d093bd8' && git branch -d 'worktree-agent-adb1acc7f1d093bd8'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-af3357f8493595756' && git branch -d 'worktree-agent-af3357f8493595756'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-afa48accd3f453029' && git branch -d 'worktree-agent-afa48accd3f453029'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-afcde7fea54e12d1f' && git branch -d 'worktree-agent-afcde7fea54e12d1f'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/blueprint-step-words' && git branch -d 'fix/blueprint-step-words'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b01' && git branch -d 'fin/b01'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b02' && git branch -d 'fin/b02'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b03' && git branch -d 'fin/b03'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b03-chk20'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b04' && git branch -d 'fin/b04'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b05' && git branch -d 'fin/b05'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b06' && git branch -d 'fin/b06'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b07' && git branch -d 'fin/b07'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b08' && git branch -d 'fin/b08'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b09' && git branch -d 'fin/b09'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b10' && git branch -d 'fin/b10'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b12' && git branch -d 'fin/b12'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b13' && git branch -d 'fin/b13'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b14' && git branch -d 'fin/b14'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b14-chk11'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b15' && git branch -d 'fin/b15'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b16' && git branch -d 'fin/b16'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b16-chk10'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b17' && git branch -d 'fin/b17'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b18' && git branch -d 'fin/b18'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b19' && git branch -d 'fin/b19'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b20' && git branch -d 'fin/b20'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b21' && git branch -d 'fin/b21'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b23' && git branch -d 'fin/b23'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b24' && git branch -d 'fin/b24'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-b25' && git branch -d 'fin/b25'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fin-integrate' && git branch -d 'fin/integrate'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/fix-red-tests' && git branch -d 'fix/red-tests'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/hungry-clarke-3e9917'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r03-ds-02' && git branch -d 'lp/r03-ds-02'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r07-fos-01' && git branch -d 'lp/r07-fos-01'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r18-cb-11' && git branch -d 'lp/r18-cb-11'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r19-fos-02' && git branch -d 'lp/r19-fos-02'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r20-cp-02' && git branch -d 'lp/r20-cp-02-payments-usd'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r22-cp-07' && git branch -d 'lp/r22-cp-07'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r23-cp06' && git branch -d 'lp/r23-cp06-upload-heic'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/lp-r24-fos-04' && git branch -d 'lp/r24-fos-04'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/money-hourly-beats' && git branch -d 'claude/money-hourly-beats-2026-10-21'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/repair-fee-upfront' && git branch -d 'claude/repair-fee-upfront-2026-10-20'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/restore-templates' && git branch -d 'claude/restore-templates-2026-10-20'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/set-a-integration' && git branch -d 'claude/set-a-fix-2026-10-20'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ship-main'
git worktree remove '/Users/chrisstanbridge/.codex/worktrees/bank-outreach-release/fundhub-platform' && git branch -d 'codex/bank-outreach-release'
git worktree remove '/Users/chrisstanbridge/Developer/fundhub-applinks-speed' && git branch -d 'claude/apply-links-speed-2026-10-21'

# C. Two loose items git does not know. Move them, do not delete them.
mkdir -p ~/.Trash/drift-cleanup-2026-10-24
mv '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/slo-197' ~/.Trash/drift-cleanup-2026-10-24/
mv '/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/blueprint-intended-ai-csm.patch' ~/.Trash/drift-cleanup-2026-10-24/
```

Notes on the list:

- 4 of these branches also exist on GitHub (`origin/claude/repair-fee-upfront-2026-10-20`, `origin/claude/restore-templates-2026-10-20`, `origin/claude/set-a-fix-2026-10-20`, `origin/claude/apply-links-speed-2026-10-21`). The list leaves the GitHub copies alone.
- Removing the Codex app folder leaves its empty wrapper folder `~/.codex/worktrees/bank-outreach-release/`. The Codex app owns that.
- The `.env` and `credentials` links inside the folders are links to the main folder. `git worktree remove` unlinks them. It does not follow them.
- The ASK rows and the KEEP-WORK rows are not in this list.

## How I checked

- **List:** `git worktree list --porcelain`, 97 entries. I skipped drift-cleanup. The other 96 are in the data file.
- **Each worktree:** branch or detached head; last commit date; folder missing or not; unsaved files (`git status --porcelain`, skipping `node_modules`); commits not on `origin/main` (`git rev-list`); merged or not (`git merge-base --is-ancestor`); same patch already in main (`git cherry`); branch on GitHub or not; newest file change (skipping `node_modules` and `.git`); CLAUDE.md and AGENTS.md compared by git hash against `origin/main`.
- **Extra checks:** ignored files in each folder (names only); whether each is a link; programs running inside a folder (`lsof`); files hidden from `git status` by git flags (none found); a second full re-test of every REMOVE-SAFE row right before this file was written.
- **Rules I kept strict:** when in doubt the row is KEEP-WORK or ASK. A real `.env`, a real `credentials` folder, or ignored proof files that exist only in a folder make it ASK. A branch that is not an ancestor of main is never REMOVE-SAFE.
- **Not done on purpose:** no `.env` or `credentials/` file was opened. Nothing real was removed, pruned, moved, committed or pushed. The only files I wrote are `phase-6-old-copies.md` and `phase-6-old-copies.tsv`. I also ran `git worktree remove` once inside a throwaway test repo in the temp folder. It proved that git leaves the real file alone when it removes a folder that holds a link.
- **Slow commands:** none. Every command finished.

## Data file columns

`phase-6-old-copies.tsv`: `bucket`, `kind`, `location_type`, `path`, `branch`, `head`, `last_commit_date`, `last_commit_subject`, `path_exists`, `prunable`, `locked`, `dirty_entries`, `commits_not_on_origin_main`, `commits_behind_origin_main`, `fully_merged_into_origin_main`, `same_patch_already_in_main`, `all_touched_files_already_in_main`, `branch_exists_on_origin`, `origin_branches_with_head_other_than_main`, `last_file_change_mst`, `hours_since_file_change`, `newest_file`, `claude_md_lines`, `claude_md_same_as_origin_main`, `agents_md_same_as_origin_main`, `rule_files_differ_from_origin_main_at_head`, `ignored_entries_kept`, `ignored_links_to_main`, `size_mb`, `git_branch_d_will_work`, `why`.

