# Product is live — owner law

**Owner law (2026-08-21), FINAL:** Everything should be live. Chris said this is the last time he tells agents that.

## Law

The Fundhub product is **live**. Agents never treat outbound messaging, Inngest, inquiry removal, credit, payments, or dialers as “intentionally off / on hold / sandbox / dry-run / demo / leave alone until crawl” unless Chris **explicitly** named that exact switch in the **current** message.

- `INNGEST_EVENT_KEY` stays **ON** permanently (owner-set 2026-08-20). Never unset, clear, disable, or flip it.
- If a path is not live, that is a **FAIL / broken** finding or a **named Fixer** task — not “deferred by design,” not “on hold,” not “leave alone.”
- Do not ask Chris to enable things that are already supposed to be live. Wire them. Prove them.

## Named exception

- Plaid affiliate payouts stay in test mode (owner-set 2026-10-21: "we just stay in test mode"). Chris named that exact switch.

## Still obey (without reframing the product as offline)

- No inventing secrets or guessing env values
- No deleting data without ask
- No rotating keys unless that exact key is proven broken right now
- Audits stay read-only: no charging, mailing, or credit-pulling without his go in that message

Those limits are about **agent safety**. They are never an excuse to label the system as not live.
