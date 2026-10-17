# Fundhub company app funnel download — intended

## Role

A Fundhub customer who reaches `https://apply.fundhub.ai/thank-you`.

## One job

Open the official company Fundhub app listing from the thank-you page.

## Flow

1. The existing thank-you page loads and stays usable.
2. Its footer loads `https://fundhub.ai/funnel/fundhub-app-download.js`, which reads `https://fundhub.ai/funnel/fundhub-app-download.json`.
3. While the company app has no public Apple listing, the setting holds an empty URL and `listing_verified: false`; no app card appears.
4. After the official **company Fundhub app** listing is public, its `https://apps.apple.com/.../app/.../id...` URL is checked against Apple's page and placed in the setting with `listing_verified: true`. The known Fundhub Prompter listing ID is rejected even if set by mistake. TestFlight links and other hosts are rejected.
5. One company app card appears below the confirmation hero. Its button opens that Apple listing in a new tab. The card never mentions or links to Fundhub Prompter.

## States

- Loading: the thank-you page works while the small setting loads; no placeholder card is shown.
- Empty: missing URL or unverified setting leaves the card absent.
- Error: failed fetch, invalid setting, unsafe URL, or missing hero leaves the card absent.
- Full: one Fundhub company app card links to the verified Apple listing.

## Release boundary

This is a prepared draft. Do not publish the company script to the live funnel or fill the setting until Apple has a public company listing. A later ClickFunnels push replaces the old Prompter footer script with this company script on the existing builder page; it does not replace the page body or its booking flow.
