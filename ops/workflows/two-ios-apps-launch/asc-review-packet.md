# Fundhub Portal App Store review packet — 2026-10-17

## Proven Apple state

- App `6823985032`, bundle `ai.fundhub.app`, SKU `FUNDHUB-APP-001`.
- iOS version `1.0`, build `1`, delivery `2dbc0fed-41c5-4723-81f1-f4cf0c6bbf3d` is `VALID / APP_STORE_ELIGIBLE` and attached to the version.
- Metadata, free U.S. availability, Finance category, 18+ age rating, and automatic release after approval are saved.
- App Review page says “Items you submit to App Review will appear here.” No item is submitted yet.

## Ready assets and reviewer path

- Screenshot: `ops/workflows/fundhub-first-page-contrast.png` (1206 × 2622, corrected readable sign-in screen, no customer data). Apple accepts this size for its iPhone Dynamic Island medium display slot. It has not been uploaded.
- `client@fundhub.ai` is a production test client login. Its password is local-only in `credentials/fundhub-launch-test-accounts.env` (mode 0600, excluded from Git). Do not put the password in this packet or a commit.
- Review path: on the first screen, tap “Fundhub team? Use your password,” enter the test client email and password, then view the client portal. This path was API-tested, but a physical iPhone sign-in remains unproven.
- Public support email: `support@fundhub.ai`; a public Fundhub support phone appears at `public/roadmap/pay.html`. Confirm the actual App Review contact details with the owner before entering them.

## Still required before Add for Review / Submit

1. Upload the screenshot, enter reviewer login and contact, and give Apple concise navigation notes.
2. Complete and publish the truthful App Privacy answers; source inventory is `app-privacy-inventory.md`. In-app WebView traffic counts. Unresolved details include Plaid payment data, retained IP/usage logs, and tracking.
3. Complete Content Rights. The app accesses client-uploaded documents and third-party lender material, so do not assert “no third-party content” without proof; ask the owner to confirm rights/permitted use before selecting the affirmative answer.
4. Verify the portal Ship run and live call-confirmation journey; then verify App Review receipt after final submission. Do not call it live before Apple's approval and public listing.

Physical iPhone is currently unavailable to `devicectl`; the real-device sign-in/push checks remain open. The APNs production key trio is not in production, so a delivered push banner is not proven.
