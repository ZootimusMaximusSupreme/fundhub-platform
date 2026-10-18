# Fundhub company UX refresh — shared board

## One-page preview made 2026-10-17

- Client portal home: [`client-portal-home-preview.html`](company-ux-refresh-2026-10-18/client-portal-home-preview.html)
- Review images: [`desktop`](company-ux-refresh-2026-10-18/client-portal-home-desktop.png) · [`iPhone width`](company-ux-refresh-2026-10-18/client-portal-home-mobile-fold.png)
- Revised visual direction after owner feedback: a mobile-first iOS-style client home, with a deep graphite funding-file card, soft grouped panels, native-feeling type and spacing, one white primary action, a slim iPad-style side rail on desktop, and a frosted bottom tab bar on phone. The file status and next step lead the screen.
- This is a standalone design preview with labeled sample content. It is not connected to client data and does not change the live portal.

## Next implementation pass

- [ ] Owner reviews the preview before any live page edit.
- [ ] Keep the current client journey and real portal data. Replace all sample status/next-step copy with values verified from the existing portal read; show honest loading, empty, and error states.
- [ ] Keep Documents, Activity, and advisor actions wired to their existing destinations. Do not infer a funding step from entitlement alone.
- [ ] Check the implemented page at 1440px and 390px with Playwright, plus a real iPhone before calling it ready.

## Preview checks

- Chromium screenshots captured at 1440px desktop and 390px phone widths. The mobile fold now shows both the file status and the next step.
- No horizontal scroll at 320px, 390px, or 1440px.
- The primary progress link, all four mobile tabs, advisor help link, and all three grouped rows were clicked in Chromium. No page-script errors.
- Live page and API routes unchanged.
