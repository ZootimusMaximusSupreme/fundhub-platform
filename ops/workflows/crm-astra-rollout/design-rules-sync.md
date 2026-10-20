# Approved Astra design rules sync — 2026-10-20

The approved design is now reflected in the authoritative `docs/rules/UI-STANDARDS.md`; the existing Cursor rule remains a short pointer. This is a documentation sync to the saved implementation and owner contract, not a new design or fresh live/device proof.

## Exact files

- `docs/rules/UI-STANDARDS.md`: incorporated the approved shared/cohort cascade, existing brand/font/tenant behavior, phone contract, current header and retained proof gates.
- `.cursor/rules/ui-standards.mdc`: retained the existing app/wireframe scope and `alwaysApply:false`; added exactly the five manifest-owned root client/entry pages (`login`, `portal-login`, `reset-password`, `contract`, `progress`). No general `public/**` or ad/funnel scope was added.
- `ops/workflows/crm-astra-rollout/design-rules-sync.md`: this receipt.

No existing Claude UI mirror was found by listing `.claude/rules/` and searching `.claude/` for `UI-STANDARDS`, layout-law, screen-frame or old size references. No new mirror was created.

## Contradictions resolved

| Old rulebook claim | Approved/current rule |
|---|---|
| 40px targets and 11px phone text | Main body/inputs 16px, captions at least 13px, visible hit areas at least 44px; primary actions preferably 48px. |
| Pipeline's historical appearance overrides the rulebook | Approved Astra shared/cohort sheets and the Team & Access treatment are the current presentation reference; Pipeline retains its specialist board. |
| Forced inherited type, 20px title and one caption escape rule | Current brand CSS provides semantic defaults; Astra uses 16/13/22/32px tokens and scoped responsive rules. The source test forbids universal forced inheritance. |
| Every heading must become caps-mono; values can never sit beside labels | Reuse the approved sans, normal-case headings/labels and compact summary label/value rows. |
| Fixed 228px rail and duplicated page-width rule | Existing shell tokens currently use 224px/72px with the phone drawer; page width remains fluid and the retained reading token stays intact. |
| Literal 8px-only spacing rejects existing compact adjustments | Keep the established page-spacing rhythm and reuse the already approved compact Astra control/page rules; no new spacing scale. |
| Tenant ramp repaints all status colors | Existing `paintBrand()` preserves the four semantic status tokens; tenant ink/paper/spectrum/accent/type/wordmarks remain supported. |
| Every page copies a dark legacy topbar cluster | Staff uses the current shared header, including the F menu beside Calendar/page title; client and public-page boundaries stay intact. |
| All inputs must inflate to normal form geometry | Only saved PDF annotation boxes keep fixed-document geometry; normal text and signing controls retain the owner floors. |

Compatible one-job/primary-action, role, grid, state, feedback, fluid-width, shadow, non-color status and release rules remain. Historical August evidence is labeled as historical. No new palette, framework, layout, permission or functionality was introduced.

## Source review and verification boundary

Read the full create-rule skill, latest primary `AGENTS.md`, recovery board, original rollout approval/phone contract, all three Astra sheets and current brand CSS; inspected font selection, shell/menu/tenant handling, actual staff/client/affiliate/public-signing includes, and existing source-test assertions. The authoritative doc now names the unchanged width, frame, status, font, script/ID/cascade and PDF-geometry checks.

Present's existing source-only guard still asserts an 11px legacy declaration. The final Astra cascade supplies the approved rendered floor; the doc explicitly says the historical source check is not a waiver. No test was changed.

Final document checks: all three files have clean trailing whitespace and final newlines; the approval link resolves. The five added root-page patterns match the rollout manifest exactly. The existing tracked audit skill remains at `.cursor/skills/fundhub-ui-auditor/SKILL.md`, so the pointer retains that path.

Only the three documentation/rule files above were edited. App assets, tests, performance rules, finish rules, credentials, data, Git and deployment were not changed by this lane. No browser or heavy tests were run during proof-tool recovery; root owns independent checks and GitHub retention. No prior failed measurement or missing physical/native-device proof is cleared by this sync.
