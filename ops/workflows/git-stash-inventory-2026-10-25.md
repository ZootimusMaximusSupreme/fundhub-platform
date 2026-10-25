# Git stash inventory — 2026-10-25

## Cleared 2026-10-25

Chris wanted clutter gone; **39** stashes removed with `git stash clear`. Main on GitHub unchanged (ops note commit only).

---

**Count (before clear):** 39 stashes

**Oldest (by reflog date):** `stash@{38}` — 2026-10-05 14:23:02 -0700 — `On main: wip-unrelated-fhconsulting-ship`

**Newest:** `stash@{0}` — 2026-10-08 16:34:56 -0700 — `On main: mid edits during size fix`

Most entries are short-lived WIP parked during ship (`hold during … ship`, `pre-ship … WIP`, `mid-edit`, etc.). None were dropped in this cleanup (Chris asked for branch cleanup only).

**Chris can run `git stash clear` to wipe them all, or pick one stash to keep** (for example `git stash show -p stash@{N}` then `git stash apply stash@{N}` before clearing the rest).

## Full list (newest first)

| Index | Message |
|-------|---------|
| stash@{0} | mid edits during size fix |
| stash@{1} | On main: mid-edit sweep before ship |
| stash@{2} | On main: calls and pixels mid-edit |
| stash@{3} | On main: banks gap mid-edit |
| stash@{4} | On main: brain gap mid-edit |
| stash@{5} | On main: staff test mid-edit |
| stash@{6} | On main: lane edits not part of bundle wiring |
| stash@{7} | On main: pre-ship marketing again |
| stash@{8} | On main: wip not teleprompter |
| stash@{9} | On main: hold unrelated files during pulse ship |
| stash@{10} | On main: pre-ship leftover WIP |
| stash@{11} | On main: pre-ship recordings WIP |
| stash@{12} | On main: pre-ship monitoring WIP |
| stash@{13} | On main: hold marketing during pulse ship |
| stash@{14} | On main: hold unrelated during drive save ship |
| stash@{15} | On main: unrelated-wip-before-drive-save |
| stash@{16} | On main: registry only |
| stash@{17} | On main: pre-ship pulse marketing WIP |
| stash@{18} | On main: hold wip during align ship |
| stash@{19} | On main: hold unrelated before teleprompter ship |
| stash@{20} | On main: unrelated wip before script-swap ship |
| stash@{21} | On main: unrelated wip before teleprompter ship |
| stash@{22} | On main: hold slice-32 test |
| stash@{23} | On main: hold dirty files for text-on reship |
| stash@{24} | On main: hold marketing during brief ship |
| stash@{25} | On main: hold marketing dirty files |
| stash@{26} | On main: hold unrelated marketing |
| stash@{27} | On main: hold parallel edits during teleprompter ship |
| stash@{28} | On main: wip unrelated marketing |
| stash@{29} | On main: hold wip for tap ship retry |
| stash@{30} | On main: hold marketing wip during tap ship |
| stash@{31} | On main: hold during text ship |
| stash@{32} | On main: hold again for text ship |
| stash@{33} | On main: hold unrelated and tap edits |
| stash@{34} | On main: unrelated marketing files before teleprompter ship |
| stash@{35} | On main: ship-stash |
| stash@{36} | On main: wip not teleprompter — parked for ship |
| stash@{37} | On main: wip not in film-link ship |
| stash@{38} | On main: wip-unrelated-fhconsulting-ship |
