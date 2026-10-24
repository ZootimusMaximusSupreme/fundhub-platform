# Commas catalog — hands off

**Owner law (2026-08-27):** The live Commas product catalog is done. Agents do not add, rename, duplicate, or "fix" it.

## Keep only these titles

From `src/config/offers.mjs`:

- Consulting Services Assessment
- Consulting Services Engagement
- Consulting Services Package
- Consulting Services Standard
- Consulting Services Trial
- Consulting Services Program
- Consulting Services Records
- Consulting Services Completion
- Consulting Services Deposit
- Business Financial Assessment

## Never

- `POST /public-api/products/create`
- A checkout mint that creates a **new** catalog row (new title, "e2e", "lane", "do not pay", UnderwriteIQ, Credit repair, Funding done-for-you)
- Edit, archive, or delete a **keep** product
- Recreate a keep product because you cannot find the id

## Always

- Reuse an existing keep product id
- If checkout needs a title, use the exact keep string. Prefer attaching the existing product id
- A test or e2e run that would mint a new Commas product is a **stop**

```text
❌ createCheckoutSession({ productTitle: "Credit repair, done-for-you" })
❌ createCheckoutSession({ productTitle: "Lane 4 combo mint — do not pay" })
✅ Pay link on the existing Consulting Services Assessment / Standard / Engagement id
```
