# Fundhub iOS — App Review 2.1 response draft

Status: **historical draft**. The final text is `app-review-final-notes.txt`; it was saved to Apple's App Review Information → Notes on 2026-10-18. The physical-device mirror video was attached and the same iOS 1.0 submission returned to `WAITING_FOR_REVIEW`. The separate Resolution Center message was not sent because browser sign-in did not complete. The demo password belongs only in Apple's review sign-in field, never in this tracked file.

## Paste-ready reply (complete the bracketed items first)

Hello App Review team. Thank you for reviewing Fundhub 1.0. Here is the information requested:

1. **Physical-device recording.** We have attached [recording filename/link], captured on [iPhone model] running [latest iOS version]. It starts at app launch and shows sign-in, the native client Home, and **Open full portal**. It also shows the portal's account/history and any available payment view. Fundhub does not offer self-registration in the app or a public user-content feed, so there is no registration or public report/block flow to show. [State exactly what the recording shows about account deletion and paid features; do not claim a flow that was not recorded.]

2. **Purpose and audience.** Fundhub is a private service portal for existing Fundhub clients and team members. Clients who are seeking business funding use it to see the status of their Fundhub file, their advisor, documents and amount due, then open the portal for their next steps. Staff open their role-specific workspace. It helps a client follow one service file without switching between emails and web pages. Fundhub is a business-financing advisory and referral service, not a bank or direct lender; funding partners make financing decisions.

3. **How to access the features.** Use the client demo account already entered in App Review Information → Sign-In Information. From the first screen, tap **Fundhub team? Use your password**, then enter the demo email and password. On Home, review **Your file**, then tap **Open full portal** to view the client's detailed portal. The normal client path is **Email me a sign-in link** followed by **Paste a sign-in link**; the password path is available for the reviewer test account. Staff have a separate role-based workspace. No sample file is needed to open Home; [identify any seeded sample documents/transactions if the recording or review notes refer to them].

4. **External services.** The native app connects to Fundhub's own API and portal at `fundhub.ai` (hosted on Netlify) for sign-in and client data; the service stores account data in its Supabase-hosted PostgreSQL database. Client sign-in emails use Resend. Optional iPhone alerts use Apple Push Notification service. In the web portal, eligible clients may see external payment links and optional bank-linking through Plaid; these are not needed to sign in or inspect the demo file. [Confirm the specific payment provider and whether it appears in the demo flow before naming it to Apple.]

5. **Regions.** This App Store submission is currently offered in the United States only. There is no separate regional version of the app UI. The file details and any funding offers are specific to each client and may differ by state and account; we are not claiming that every client sees the same offers.

6. **Financial service and third-party material.** Fundhub LLC provides business-financing advisory/referral services and is not a bank or direct lender. The app shows each signed-in client's private Fundhub file, including documents the client supplies and information about third-party funding options where applicable; it does not offer a public catalog of third-party protected content. Attached are [verified Fundhub entity/registration document], [any required service authorization or partner agreement], and [permission or source evidence for any third-party protected material actually visible in this build]. [If no such document is applicable, explain the precise reason; do not claim an authorization that has not been verified.]

The privacy policy is `https://fundhub.ai/privacy/`, and support is `support@fundhub.ai`.

## Account, user content, and payment details for the video/Notes

- The iOS source has client email-link sign-in and password sign-in, but no self-registration control. Client accounts are tied to an existing Fundhub client record. The iOS source has **Sign out**, not an in-app **Delete account** control. The published privacy policy directs deletion/privacy requests to `support@fundhub.ai` with subject **Privacy Request**. Do not say an in-app deletion screen exists.
- The client portal has private client-to-team messages and document upload; there is no public feed in the native app. Do not label private support chat as a public report/block feature.
- The native Home has no purchase button. The portal can show invoices/payment links and products priced on an advisor call; one soft-pull item is displayed at $32. Do not tell Apple that the whole app has no paid services. Confirm what the demo account and video actually display.
- The demo account's Home/portal was tested as a live client in prior launch work, but no real-iPhone review recording or sample-document inventory is recorded in this repo. Recording must match the **submitted build**, not a later source branch.

## Evidence and unresolved items

| Claim | Repo evidence / check still needed |
| --- | --- |
| Native Home, reviewer taps, client/staff paths | `tools/fundhub-ios/Fundhub/App/FundhubApp.swift`; `tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift`; `tools/fundhub-ios/Fundhub/UI/WorkspaceWebView.swift` |
| Isolated review client/password path | `ops/workflows/two-ios-apps-launch/test-logins-push.md`; credential location is local-only `credentials/fundhub-launch-test-accounts.env` |
| Business purpose and non-lender role | `public/terms/index.html` (service description); `public/index.html` (non-lender statement) |
| Portal invoices, documents, messages, paid offers | `public/app/client-portal.html`; actual demo data and paid controls in submitted build still need a real-device check |
| Hosting, email, database, notifications | `netlify.toml`; `docs/sops/RUNBOOK.md`; `src/messaging/providers/resend.mjs`; `tools/fundhub-ios/Fundhub/Core/NativePush.swift` |
| U.S. availability | `ops/workflows/two-ios-apps-launch.md` records the saved App Store region; recheck current App Store Connect availability before sending |
| Privacy deletion request | `public/privacy/index.html`; no native deletion control found in `tools/fundhub-ios/Fundhub/` |
| Protected/regulated service documents | No matching authorization, license/registration, partner-rights, or content-rights evidence found in `docs/` or the launch packet. Obtain exact applicable documents or a verified non-applicability explanation before answering item 6. |

**Do not submit yet:** the physical iPhone video, its device/OS/build identification, actual demo file contents, payment provider in the reviewer path, and item 6 supporting documentation remain unverified in this draft. Copy the final answers into both the Resolution Center reply and App Review Information → Notes, as Apple requested.
