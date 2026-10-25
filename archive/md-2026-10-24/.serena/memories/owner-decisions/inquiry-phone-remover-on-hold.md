# Owner decision: inquiry phone remover on hold

**Date:** 2026-08-15
**Owner:** Chris

## Decision
Inquiry phone remover (Bland / phone-agent inquiry removal) is **on hold**.

## Why
Scripts need to be updated before that system moves again.

## Implications for agents
- Do **not** rebuild, rewire, or “update from the credit-repair letter prompt” the inquiry phone remover until Chris lifts this hold.
- Repair letter / education updates from `docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md` may proceed separately.
- Letter-side inquiry / personal-info cleanup may pull matching pieces from that doc; phone inquiry removal stays its own system and stays parked.

## Related
- Credit repair letter prompt is TODO / not live; COMPLIANCE REVIEW REQUIRED before customer-facing use.
- Detection stays in Metro 2 code; the prompt is for letter wording and routing only.
