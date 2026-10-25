# Landing-page archives

Date: 2026-10-24. Branch `drift-cleanup`. No commit.

Branch check: `git branch --show-current` printed `drift-cleanup`.

Searched `src/`, `scripts/`, `api/`, `public/`, and `netlify/` for each filename. No code reads these files. Compared each file to `git show c54f936a4:<path>` before the move. The six files matched the baseline. No sentence was dropped. Nothing was deleted.

## Moves

Each move used `git mv`. Same relative path under `ops/archive/ai-instructions-2026-10-24/`.

| ID | From | To | Note |
|---|---|---|---|
| A9 | `marketing/landing-pages/fixes.md` | `ops/archive/ai-instructions-2026-10-24/marketing/landing-pages/fixes.md` | Old paste-into-ClickFunnels output. Live fragments stay in `marketing/landing-pages/` and go out through `scripts/cf-push-custom-html.mjs`. |
| A10 | `marketing/landing-pages/fixes-v2.md` | `ops/archive/ai-instructions-2026-10-24/marketing/landing-pages/fixes-v2.md` | Same family as A9. |
| A11 | `marketing/landing-pages/fixes-v3.md` | `ops/archive/ai-instructions-2026-10-24/marketing/landing-pages/fixes-v3.md` | Same family as A9. |
| A12 | `marketing/landing-pages/roadmap-updates-2026-09-21.md` | `ops/archive/ai-instructions-2026-10-24/marketing/landing-pages/roadmap-updates-2026-09-21.md` | Old spec. The live page is `marketing/landing-pages/slo/slo-01-sales.html`. Testimonial cards are live. |
| A13 | `marketing/landing-pages/slo/SNEAK-PEEKS-FOR-CLAUDE.md` | `ops/archive/ai-instructions-2026-10-24/marketing/landing-pages/slo/SNEAK-PEEKS-FOR-CLAUDE.md` | Old paste brief. `SLOT-SNEAK-PEEKS` is gone. Sample cards live on `slo-01-sales.html`. Did not edit `CHECKOUT-FOR-CLAUDE.md` (do-not-touch / other agent). |
| A14 | `marketing/landing-pages/slo/FUNDHUB-297-FUNNEL-README.md` | `ops/archive/ai-instructions-2026-10-24/marketing/landing-pages/slo/FUNDHUB-297-FUNNEL-README.md` | Old 9/18–9/20 folder list. Live book is `marketing/landing-pages/slo/README.md`. See A14 open items below. |

## A14 open items

The stale plan said to copy still-open items from lines 26–32 into `TODO.md` before the move. I read that list, then checked the live pages. None of the six items are still open, so I did not add them to `TODO.md`. The full list still sits in the archived file.

| Item | Still open? | Proof |
|---|---|---|
| Bump price placeholder on checkout | No | No `CHRIS FILLS` / bump-price hole on `slo-01-sales.html` or `slo-02-order.html`. Checkout bump is off. |
| Support email and phone placeholders | No | Live footer has `support@fundhub.ai` and `(561) 304-8368`. |
| Six empty testimonial slots | No | Live cards: Colin, Gene, Sarah. |
| Roadmap months 5–6 print EIN, DUNS, and net-30 | No | Live sample months 5–6 are blurred sneak peeks. Zero `DUNS` or `net-30` on `slo-01-sales.html`. |
| Refer-a-friend button missing in the portal | No | `public/app/client-portal.html` has a Refer a friend card. |
| Confirm affiliate rate 25% vs 20% / 5% | No | Live pages and docs still state 20% direct and 5% second tier (`public/affiliates/index.html`, `public/partner/menu/index.html`). |

## Pointer fix

`marketing/MACHINE-GAPS.md` line 145. That line is a status note, not a standing law. The sentence stayed. Only the path changed.

- Before: `ops/workflows/full-launch-lattice-2026-09-20.md:506`
- After: `ops/archive/ai-instructions-2026-10-24/ops/workflows/full-launch-lattice-2026-09-20.md:506`

That archive file exists. Line 506 is the AG-09 talk UNVERIFIED row. No text went to `removed-lines/`.

## Skips

None of A9–A14 were skipped.

## Leftover pointers I did not edit

Other people own these files, or they are on the do-not-touch list.

- `marketing/landing-pages/CURSOR-PROMPT.md` lines 60 and 83 still name `fixes.md` as a deliverable. Stale S41 is supposed to trim that file.
- `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md` lines 134 and 209 still name `SNEAK-PEEKS-FOR-CLAUDE.md`. I did not touch it.
- `ops/workflows/drift-cleanup-2026-10-24/reports/safe-archives.md` still says A9–A14 were skipped. That report is history from the earlier slice.

## Not touched

`PROGRESS.md`, `CLAUDE.md`, `AGENTS.md`, `RULES-INDEX.md`, `.ai/rules/`, `.agents/skills/`, `marketing/ads/`, `docs/sops/`, `docs/rules/TELEPROMPTER-VIDEO.md`, `scripts/hooks/`, `TODO.md`, and the two ClickFunnels do-not-touch briefs.
