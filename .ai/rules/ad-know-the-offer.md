---
description: Before an ad script or an animation overlay, read the offer. Pictures show what the product does.
alwaysApply: true
---

# Know the offer before you write or animate

**Owner law (2026-10-25):** A hook is not enough. Before an ad script or an animation overlay for an offer, read that offer. The pictures show what the product does. They come from the offer and from his product description. They do not come only from the sentence he said in the last chat.

## Always

- Read the offer first. Name the file you read.
- Show the product doing its real steps.
- A sample number must come from the offer, the /roadmap sample, or a number already in that script. Never invent a number, a bank, a name, or a claim. Label a sample as a sample.

## Never

- Write or animate from the last sentence alone.
- Invent a dashboard step the offer does not do.
- Mix numbers from two different sample files.

## Capital Blueprint

Chris, 2026-10-25. This list wins if an older doc fights it.

Capital Blueprint takes their file and tells them, step by step, what to do.

1. Pay a card down. He said pay down a card, and pay down Chase.
2. Remove the negative items. Show that action. Then show the next thing to remove.
3. Show the payoff.
4. Items come off. Credit goes up.
5. The disputes were sent.
6. Business one is primed and ready.
7. Business two is primed and ready.
8. Then more fundability.

Also true in the repo. Keep these. His list above still wins if they fight.

- The buyer gets a credit analysis, a dispute letter pack, a credit optimization roadmap, a funding snapshot, a bank and lender match list, and a short how-to. The price is $5,000 to $10,000. The default is $5,000. File: `src/config/offers.mjs`.
- On their own file the steps are: pay each card down to a target from that file, do not open new credit, talk to the Fundhub team about a personal loan, file the LLC, get the EIN, open a business checking account, print and mail the dispute letters, upload the mailing proof, and upload the bureau letters when they come back. Files: `db/migrations/362_waypoint_definitions_seed.sql`, `db/migrations/400_blueprint_dispute_waypoint_definitions.sql`, `db/migrations/498_waypoint_steps_fundhub_team.sql`.
- It runs 12 months. An AI coach watches the open step. The Fundhub team does what a person must do. There is no named human advisor. It does not promise a funding amount or an approval. File: `docs/journeys/capital-blueprint-intended.md`.
- Fundability is a count of the engine's own checks. Each business is judged on its own, after the personal file is ready. The businesses are not added into one pile. File: `src/finance/fundability.mjs`. The walk order is personal file, then each company, then the lender list. File: `src/underwrite/funding-sequence.mjs`.
- The ads also say 13 optimization points, done in the right order: which cards to pay down, which items to remove, which items to add, which banks to open, where to put the money, and how to set the business up so a bank sees it as established. You learn it by doing the steps on your own file. The script guarantee is that this is the last tool you use to learn the funding game. Files: `marketing/ads/scripts/2026-10-14.md` and `marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md`.
- The flywheel note names `marketing/offers/capital-blueprint-owner-definition-2026-10-14.md`. That file is not in the repo. Use the files above.
- Sample numbers already printed for the /roadmap sample (label them sample): middle score 762, $199,350 today, $221,500 once fixed, American Express Blue Business Cash from $4,800 down to $2,500, Chase Sapphire Preferred from $2,100 down to $1,200. File: `ops/workflows/2026-10-02-roadmap-sample-content/w1-samples.json`. The dashboard drawing uses the tabs Personal, Business 1, and Business 2. File: `marketing/broll/src/templates/BlueprintDashboardOS.tsx`.

## Example

```text
He says "your dashboard lays out every step."

❌ A spinner that says "Your file," with no pay-down, no dispute, and no businesses.
✅ The dashboard walks the real steps: pay a card down, remove a negative, disputes sent, items off, credit up, business one ready, business two ready, more fundability. Sample dollars stay labeled sample.
```
