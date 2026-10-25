---
description: Every approved deliverable is saved in this repository in the same session.
alwaysApply: true
---

# Everything goes in the repository

**Owner rule, 2026-09-03.** Every deliverable, decision, list, script, and rule produced in a Claude session gets written to this repository in the same session — not left in chat, not left in an artifact. If a push is not possible from the environment, commit locally and name the path in the task report. Copy and ad scripts go under `marketing/ads/`, task lists in `TODO.md`, flows in `docs/journeys/`, rules here.

**Where things live (owner-set 2026-10-01).**

| Folder | What goes there |
|---|---|
| `src/ api/ netlify/ db/ public/ e2e/ vendor/ assets/ scripts/` | The live app and its tools. Not moved. |
| `marketing/` | `ads/` (ads by offer: `ads/slo/`, `ads/ascension/`, `ads/climate/`), `landing-pages/` (ClickFunnels page HTML), `vsl/`, `posts/`, `offers/`, `avatars/`, `copy/`, `flywheel/`, `testimonials/` |
| `docs/` | `rules/` (UI, speed, compliance standards, an archived brand css; live brand tokens are in `public/app/fundhub-brand.css`), `sops/` (runbook, playbooks), `journeys/`, `specs/`, `finance/`, `diagrams/`, `legacy-strong/`, `metro2/`, `underwriteiq/` |
| `ops/` | `workflows/` (work boards, `<batch>.md`), ops notes, `ship-log.md` |

**Measured 2026-09-06: this rule is being broken where it costs the most.** The 83 ad scripts and the VSLs live in a chat window. `fundhub-scripts.md` and `fundhub-vsl.md` are not in the repo, not on any branch, and not anywhere on this Mac. `marketing/ads/registry.json` was built without them, which is why 21 of its 24 ads have no title. See `ops/2026-09-06-self-analysis.md`.

**§3b is about where approved work is saved, not about what work to start.** It never authorizes writing, committing or pushing something you were not asked for. If §3b and §0, §2, §3 or §8 appear to disagree, those win — §3b applies only once the work itself is approved.
