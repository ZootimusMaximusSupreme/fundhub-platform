FUNDHUB SLO FUNNEL — $297 Complete Funding Diagnostic
Copy source of truth: FundHub-Copy-Source-of-Truth.md (Google Drive) + CRO Pass #1 (see COPY-CHANGELOG-Aug27.md)
Design system: fh-root (matches live fundhub.ai funnel). Built for ClickFunnels.

PAGES (merged working copies — one file per page, open in a browser to review)
  slo-01-sales.html       Sales page. Single fragment, paste as-is into one Custom JS/HTML element.
  slo-02-booking.html     Booking page.
  slo-02-order.html       Order page. Contains a SPLIT-LINE marker: split there into top/bottom
                          Custom JS/HTML elements with CF's NATIVE checkout element in between.
  slo-03-thank-you.html   Thank-you page (ALL buyers route here). SPLIT-LINE marker: top/bottom
                          elements with CF's NATIVE AppointmentScheduler in between.

THANK-YOU PERSONALIZATION (URL params on the confirmation redirect / email link)
  ?pa=84500        renders $84,500 in the pre-approval card (also accepts ?amount=)
  &track=repair    post-cleanup framing + swaps video to VSL #3
  no params        card still renders with a fallback line

SEEING THE PAGES IN A BROWSER

These files are ClickFunnels fragments - no <html> or <body> tags - so opening
one directly does not show it inside the shell ClickFunnels wraps around it.

  preview/01-sales.html
  preview/02-order.html
  preview/03-thank-you.html

Open any of those instead. They are generated - rebuild with:

  node clickfunnels-fragments/slo/preview/build.mjs
