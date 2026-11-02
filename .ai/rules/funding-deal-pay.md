---
description: On a funding deal the closer gets one fifth of the upfront. No cut of the amount funded. Clarity takes about 15% on a financed deal.
alwaysApply: true
---

# Funding deal pay

**Owner law (2026-10-30):** On a funding deal, the closer is paid one fifth of the money collected up front. One fifth is 20%. There is no closer commission on the amount that later funds. Even on a financing deal, Clarity takes about 15%.

Chris said this on 2026-10-30 while pricing a $30,000 funding deal paid up front. It replaces the closer funding-deposit rate of one sixth (16.6667%) from 2026-08-23. It also closes the closer's 0.25% of the funded amount from 2026-08-20.

## Always

- Pay the closer 20% of the funding deposit collected. On $30,000 collected, that is $6,000.
- Do not pay the closer a cut of the amount that funds later.
- On a financed deal, treat Clarity's cut as about 15% of the price. Fundhub is paid the rest up front. The closer's 20% applies to the funding deposit collected, not a second time on top of a guess.
- Leave the sales manager rates from 2026-08-20 as they are: 5% of the funding deposit, and 0.25% of the funded amount.
- Leave the closer downsell and upsell rates at 20% of each exact payment. Those are a different sale. This law is the funding deposit.

## Never

- Pay the closer one sixth of a funding deposit collected on or after 2026-10-30.
- Pay the closer 0.25% of the funded amount on or after 2026-10-30.
- Invent a Clarity fee other than the about 15% Chris set. Clarity does not publish a merchant rate card in this repo.

The live rows are in `db/migrations/531_owner_closer_funding_one_fifth_20261030.sql`. Older rate files stay as history.
