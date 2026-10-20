# Cortana autonomy assessment — 2026-10-20

## Question

Can Codex finish the Cortana/DirectROAS tracking plan without Chris operating tools, copying code, or doing routine QA?

**Owner scope correction, 2026-10-20:** this is only the free book-a-call funnel: `/watch` → `/apply` → `/funding-book-call` → `/thank-you`. It is not any paid offer. Checkout, Commas, price, sale, and Purchase work are out of scope.

## Parallel workflows

| Workflow | Owns | Dependency |
| --- | --- | --- |
| Repo execution map | Every W1–W4 build, test, ship, and live-browser action Codex can perform from this repository | None |
| External access gates | DirectROAS/Cortana, ClickFunnels, database, and GitHub access required for final proof | None |
| This session | Read every source instruction and give one final autonomous/not-autonomous answer | Waits for both reports |

## Copy-paste prompts

### Repo execution map

```text
Read-only task in /Users/chrisstanbridge/Developer/fundhub-platform. Scope only the free book-a-call funnel: /watch -> /apply -> /funding-book-call -> /thank-you. Exclude every paid offer, checkout, Commas, price, sale, and Purchase path. Read every line of the Cortana boards. For W1-W4, list exactly what Codex can build, test, push, ship, and verify without Chris. Name any missing credential or human login. Evidence paths only; do not edit or send.
```

### External access gates

```text
Read-only task in /Users/chrisstanbridge/Developer/fundhub-platform. Scope only /watch -> /apply -> /funding-book-call -> /thank-you. Exclude all paid offers and money paths. Inspect repo-provided tooling and credential-name/config evidence for DirectROAS/Cortana, ClickFunnels, database, GitHub, browser proof, and deployment. Do not print secret values. Decide which final proofs Codex can perform with existing tools and which need Chris or Paul to grant access. Do not edit, deploy, or send.
```

## Assessment

### Conclusion

Codex can complete the build, tests, ClickFunnels changes, GitHub push, deployment, live lead/booking path, network checks, and Fundhub-side reconciliation without Chris operating tools. There is no money action. The only missing access is a DirectROAS/Cortana session for dashboard-side receipt and count proof.

### What Codex can do alone

- W1: cover `/watch`, `/apply`, `/funding-book-call`, and `/thank-you`, preserve the native calendar, and prove exactly one hub load per page.
- W2: wire the book-a-call event chain: page visits, survey completion/Lead, calendar progress, confirmed booking/Schedule, and thank-you arrival. The live hub script exposes the needed custom-event and identity contract.
- W3: carry `ak_tid`, UTMs, Meta IDs, email, and phone from ad landing through survey and booking into the Fundhub lead/booking records.
- W4: add the Lead/Schedule server sender, idempotency, heartbeat/tripwire coverage, and Fundhub lead/booking count report. Read-only production database access is working.
- Delivery: ClickFunnels API listing succeeded for workspace `481896`; the stored GitHub token authenticated successfully. GitHub Actions owns production shipping.

### What still needs Chris once

1. DirectROAS/Cortana dashboard access. Chrome currently reaches the DirectROAS sign-in screen, not an authenticated dashboard, and the repo has no DirectROAS dashboard/read-API credential. Chris can either sign in once or provide a read API/export route from Paul.

### Owner effort

One go-live instruction and one DirectROAS sign-in/access handoff. Everything else is Codex work; no payment or paid-offer action is part of this job.
