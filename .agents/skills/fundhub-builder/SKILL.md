---
name: fundhub-builder
description: Governs NEW work — new screens, dashboards, features, endpoints. Triggers - build, create, add a screen, new dashboard, new feature, make me a, scaffold. Not for fixing existing things (that is fundhub-fixer) and not for auditing (fundhub-auditor).
---

# Fundhub Builder

The fourth protocol. Auditor observes, Fixer repairs, UI/Perf auditors grade — Builder is the only one that creates. Everything new enters the system through here, already governed.

Binding law: `docs/rules/UI-STANDARDS.md`, `docs/rules/PERF-STANDARDS.md`, `public/app/fundhub-brand.css`, `.cursor/rules/owner-scope-minimal-diff.mdc`.

## Prime rule

**Nothing ships without ground truth.** The platform needed a 229-finding audit because 39 screens were built before anyone wrote down what they were supposed to do. A new screen that ships without its `-intended.md` is a future finding, guaranteed. That file is what makes the screen auditable at all.

## How you write to Chris

Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade level: short words and sentences, no jargon, no status codes, no cryptic shorthand.

## Language — never a refusal

Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, for example 'This needs new code, so I'm building it now.'

## Step 1 — THE PLAN GATE (before any code)

Answer all seven in one block.

**Standing GO:** Fixer handed you an endpoint (or other new code) needed to close a named board row. Do not wait. Do not text Chris. Build it. Allowed only when the exact task is a named row on the board (owner-set 2026-10-24); otherwise `owner-scope-minimal-diff` applies and a route or field he did not request is stop-and-ask.

**Wait for "go"** only on genuinely new scope (a new screen or feature he has not already named), missing data, or a real judgment call. One word from Chris proceeds; anything else revises. Never skip that gate, never guess an answer. That is what reaches his phone. Use the relay only for a real owner decision, never for a GO already given (`owner-go-no-repeat-approval`, 2026-10-19).

When the gate-relay process is running on this Mac, do not only wait in the IDE. Write `.fundhub-relay/gates/<id>.json` with `{ question, options, context, session }`. `question` is the full ask in plain English — what is ready and what he is deciding — never a stub like "Build?" and never status. He answers in one word. Example: "Plan ready — closer now-and-next read, one role, no new buttons. Reply GO or REVISE." Then `node scripts/gate-relay/index.mjs wait <id>`. Read the decision file and proceed. The relay never edits app code.

1. **Role** — who is this for? One role. Serves three roles differently = three screens or one screen with role-scoped views; say which.
2. **One job** — one sentence. Two sentences = two screens.
3. **First question** — what does that role ask when they open it? (UI-STANDARDS §10.) The answer goes top-left, largest. "Company metrics" for anyone but the owner = stop and ask.
4. **Reuse** — what existing components, endpoints, and patterns cover part of this? Name them. Inventing a second way to do a solved thing is how 12 font sizes happened.
5. **Data** — what does it need, and do those endpoints exist? A new route = name it here.
6. **Files** — exact list of files to create and files to touch. Nothing outside the list gets edited.
7. **Risk** — what could this break, and what will prove it didn't? (One line each.)

## Step 2 — BUILD (after "go")

- Law: UI-STANDARDS section 6 (docs/rules/UI-STANDARDS.md) - every screen ships four states: loading, empty, error and full.
- **Never render a control the role cannot use.** No dead buttons, no 403-on-click, no "coming soon."
- **No new dependency without asking.** No library for one function.
- Law: PERF-STANDARDS section 2 (docs/rules/PERF-STANDARDS.md) - one shared stylesheet and design tokens; an inline style= attribute is a finding.
- Law: PERF-STANDARDS section 1 (docs/rules/PERF-STANDARDS.md) - every new screen meets the speed budgets there, measured on mobile, Slow 4G, 4x CPU.
- Request conflicts with a standard → say so in one line and follow Chris.

## Step 3 — DEFINITION OF DONE (all five, with evidence)

1. The screen, meeting the standards above.
2. docs/journeys/<name>-intended.md — every step with observable ground truth. The builder drafts the steps on the board; Chris writes or approves the intended file.
3. All four states captured as screenshots at 1440px and 390px → ops/workflows/build-evidence/<name>/.
4. Every visible control clicked once as the intended role, evidence saved.
5. Lighthouse run against budget, report saved.

Missing any of the five = not done. Do not report done. Chat claims of success count for nothing — the evidence folder and the journey doc are the deliverable.

## Handoff

Tell Chris what is going on in plain English. What you built. What still
needs data (name what is missing). What you have not checked yet. Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, never 'will not be built,' 'BLOCKED' or 'cannot.'

Builder never audits its own screen. Something it noticed that is a fix → note it for the board (Auditor grades new work). Something it noticed that needs more build to close the same row → keep going.
