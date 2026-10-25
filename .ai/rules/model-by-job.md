---
description: Which model runs which job (owner calls on Sonnet and Opus)
alwaysApply: true
---

# Model by job

**Owner calls.** These override the CLAUDE.md section 1 tier guess for the jobs named here.

- **Back end Sonnet, front end Opus (2026-10-06).** Chris: "Use Sonnet to build the back end to save tokens. Build the front end with Opus... make sure it's good." Per feature: a Sonnet back-end agent, then an Opus front-end agent after the back end is proven. Keep the 5-agent cap.
- **Ad video editing on Sonnet (2026-10-23).** The `fundhub-ad-editor` skill (whisper, cuts, loudness, shake) runs on a Sonnet agent. Chris: "use sonnet..thats a rule." Opus only briefs and relays.
- **Animations (2026-10-24).** Opus builds or changes animation templates. Sonnet only places finished ones. See `animation-builders-opus-placers-sonnet`.
- **Opus plans and checks slices, Sonnet may do the moves (owner-set 2026-10-21).** Chris also said on 2026-10-24 that Opus is not really needed here.

## Check the model before you start (CLAUDE.md section 1)

Right after the split proposal, state one line: the model this work needs, and whether the current one matches.

Format: `Model: <tier> — current is <tier>. Match / Switch.`

Rough mapping:

* Haiku — mechanical and fully specified. Copy changes, renames, formatting, single-file edits where the answer is already decided.
* Sonnet — normal build work. Building a component from a clear spec, writing tests, wiring a route.
* Opus — anything where being wrong is expensive. Architecture, debugging something that already failed once, refactors across many files, anything touching a hard rule, or work the agent cannot verify with repo tools and live proof.
* Animation templates and changes (`marketing/broll/src`, the catalog, broll tests) are always Opus. Sonnet only places finished animations (owner-set 2026-10-24).
* Owner calls on tier (`model-by-job`): back-end build units run on Sonnet, then the front end on Opus (2026-10-06); video ad editing (`fundhub-ad-editor`) runs on Sonnet (2026-10-23).

Raise thinking effort — not just the tier — for debugging and architecture. Lower it for mechanical work.

**Hard rule: if the current model is below what the work needs, say so and stop. Do not proceed underpowered and hope.** (Per the 2026-10-12 owner rule, stop only the step that needs the higher tier. Do the safe parts a lower tier can do in the meantime: reads, the board, mechanical edits.) A cheap model on expensive work is the most costly mistake available — I cannot read the output, so I will not catch it.

Overshooting is fine. If in doubt, ask for the higher tier.
