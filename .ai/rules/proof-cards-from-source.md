---
description: Proof cards come from source screenshots — never invent amounts, quotes, or faces
alwaysApply: true
---

# Proof cards come from the picture

**Owner law (2026-09-21):** When Chris asks for approval cards, client wins, or testimonials, build the card from the source image. Do not invent the card.

## Always

- Crop the real screenshot, the real text, and the real picture out of the source and put that crop on the card.
- Read the dollar amount off the picture. Put that amount on the card. Do not change it and do not invent one.
- Look at the picture and pick the category. An approval screenshot is an approval. It is not a testimonial.
- A testimonial is only a real quote that is in the source.
- If the source has no photo of a person, do not add a face.
- If the source has no name, do not add a name.
- Build the card with the proof-card HTML template at `marketing/landing-pages/slo/fundhub-proof-cards.html`. Do not edit that HTML file.
- Match that file's article markup and its switches: `data-layout`, `data-photo`, `data-name`, `data-amount`. `data-photo` stays off when there is no photo. `data-name` stays off when there is no name. `data-layout="win"` for an approval. `data-layout="quote"` only for a real quote.

## Never

- Stock faces, generic faces, or a face that was not in the source
- A made-up dollar amount, lender, quote, or name
- Calling an approval a testimonial
- A card with no source screenshot

## Example

```text
An approval email that shows $45,000 and no person becomes a win card: the cropped screenshot, amount $45,000, photo off, name off.
```
