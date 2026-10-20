# Cortana autonomy assessment — 2026-10-20

## Question

Can Codex finish the Cortana/DirectROAS tracking plan without Chris operating tools, copying code, or doing routine QA?

## Parallel workflows

| Workflow | Owns | Dependency |
| --- | --- | --- |
| Repo execution map | Every W1–W4 build, test, ship, and live-browser action Codex can perform from this repository | None |
| External access gates | DirectROAS/Cortana, ClickFunnels, Commas, database, and GitHub access required for final proof | None |
| This session | Read every source instruction and give one final autonomous/not-autonomous answer | Waits for both reports |

## Copy-paste prompts

### Repo execution map

```text
Read-only task in /Users/chrisstanbridge/Developer/fundhub-platform. Read every line of ops/workflows/cortana-tracking-2026-10-06.md, ops/workflows/cortana-funnel-setup.md, and ops/workflows/cortana-link-audit-2026-10-20.md. For W1-W4, list exactly what Codex can build, test, push, ship, and verify without Chris. Name any task that needs a product decision, a credential not already configured, a human permission dialog, or a production-money action. Evidence paths only; do not edit or send.
```

### External access gates

```text
Read-only task in /Users/chrisstanbridge/Developer/fundhub-platform. Read every line of the three Cortana boards. Inspect repo-provided tooling and credential-name/config evidence for DirectROAS/Cortana, ClickFunnels, Commas, database, GitHub, browser proof, and deployment. Do not print secret values. Decide which final proofs Codex can perform with existing tools and which need Chris or Paul to grant access or answer a product question. Do not edit, deploy, send, or purchase.
```

## Assessment

### Conclusion

Codex can complete the build, tests, ClickFunnels changes, GitHub push, deployment, live network checks, and Fundhub-side reconciliation without Chris operating tools. It cannot honestly close the entire job without two short owner handoffs: DirectROAS/Cortana account access for dashboard-side proof, and confirmation/completion of a fresh real-money purchase when Purchase must be proved end to end.

### What Codex can do alone

- W1: add the hub tag to every controllable buyer page, use the existing ClickFunnels API access, preserve the native calendar, and prove exactly one network load per page.
- W2: wire named events. The public live hub script was fetched successfully and exposes the needed client contract: conversion tracking, custom events, identity, the `ak_tid` visitor ID, and the `/e` dispatcher. No vendor documentation guess is required.
- W3: carry `ak_tid`, UTMs, Meta IDs, email, and phone through the funnel, Fundhub database, and Commas metadata, then test the complete data path.
- W4: add the server sender, idempotency, heartbeat/tripwire coverage, and the Fundhub-side count report. Read-only production database access is working.
- Delivery: ClickFunnels API listing succeeded for workspace `481896`; the stored GitHub token authenticated successfully. GitHub Actions owns production shipping.

### What still needs Chris once

1. DirectROAS/Cortana dashboard access. Chrome currently reaches the DirectROAS sign-in screen, not an authenticated dashboard, and the repo has no DirectROAS dashboard/read-API credential. `CORTANA_COMMAS_API_KEY` is only the Commas checkout key. Chris can either sign in once or provide a read API/export route from Paul.
2. Fresh Purchase proof. The old board says `$297`, but current offer code is `$147`. Demo pay never calls Commas, so a new true end-to-end Purchase proof requires a real `$147` transaction and may require card/3DS action. If an existing post-deploy real sale can supply the proof, this handoff disappears.

### Owner effort

One go-live instruction, one DirectROAS sign-in/access handoff, and—only if no natural post-deploy sale is available—one real payment confirmation. Everything else is Codex work.
