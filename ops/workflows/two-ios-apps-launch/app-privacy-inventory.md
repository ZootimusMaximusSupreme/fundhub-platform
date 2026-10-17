# Fundhub iOS App Privacy — source inventory (2026-10-17)

Discovery only; no App Store Connect answers were entered or published. Ground truth: `docs/journeys/fundhub-ios-intended.md` and `docs/journeys/client-intended.md`. Apple's [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/) says in-app WebView traffic counts, including third-party partners, and account-linked data is generally **Linked to You**. The privacy URL `https://fundhub.ai/privacy/` returned HTTP 200.

## Defensible minimum: collect, linked to user, App Functionality

| Apple data type | Source evidence |
|---|---|
| Contact Info — **Name, Email Address, Phone Number, Physical Address** | Native email sign-in: `tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift`; portal FinanceOS collects personal/business name, business phone and street address: `public/app/money-accounts.js` (`infoFields`, `renderPersonal`). |
| Financial Info — **Credit Info, Other Financial Info** | Client portal reads credit scores and accepts proof of income, bank statements and tax returns: `public/app/client-portal.html`; FinanceOS records balances, limits and payments: `public/app/money-accounts.js`. |
| User Content — **Emails or Text Messages, Photos or Videos, Other User Content** | In-app portal chat POSTs messages: `public/app/chat-widget.js`; the client portal accepts JPG/PNG/PDF uploads for photo ID, address, bank statements, SSN card and other records: `public/app/client-portal.html`. |
| Identifiers — **User ID, Device ID** | Account/client IDs and session are carried in the native/WebView auth path: `tools/fundhub-ios/Fundhub/UI/WorkspaceWebView.swift`; opted-in native push registers a generated installation UUID and APNs device token tied to that account: `tools/fundhub-ios/Fundhub/Core/NativePush.swift`, `src/push/native-store.mjs`. Push is not yet configured live, but this binary can collect it when enabled. |

The above is **App Functionality** and linked to the signed-in account in the current source. It is not proof that every field is filled by every user. Apple requires the app-level answer to cover data the app *may* collect; see [Apple's instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/).

## Do not guess these answers yet

- **Payment Info / Purchase History:** FinanceOS accepts account last four and connects Plaid Link (`public/app/money-accounts.js`), and the portal shows invoices/payments. Confirm Plaid's actual in-app data handling and whether Fundhub stores payment account details before selecting these. External checkout by itself is not collection by the app under [Apple's definition](https://developer.apple.com/app-store/app-privacy-details/).
- **Usage Data / Diagnostics / Coarse Location:** the [published Fundhub policy](https://fundhub.ai/privacy/) says IP address, browser type, page views and timestamps are collected for security/operation. Auth code stores IP, user agent and last-seen (`src/auth/login.mjs`, `src/auth/account-session.mjs`). The exact Apple type for retained IP/usage logs and any crash or analytics vendor collection needs a network/log check; no native crash or ad SDK was found in `tools/fundhub-ios/`.
- **Used for Tracking:** no ad ID, ATT request, Meta pixel, Clarity or RB2B script was found in the native source or the two direct in-app pages (`public/app/client-portal.html`, `public/app/financeos.html`). The public privacy page does load RB2B (`public/privacy/index.html`, `public/funnel/rb2b.js`), but native Privacy opens outside the WebView. The WebView permits other same-origin pages, and FinanceOS can load Plaid; confirm their real network behavior before certifying **No tracking** for the whole app. Do not mark **Yes** solely because the public website has a pixel.
- **Other Data Types / Search History:** government ID and SSN-card images are accepted as uploads; staff screens have search. Whether those warrant separate labels beyond uploaded user content depends on what is retained from the in-app flow, not just the existence of a field.

Next check: a signed-in iPhone WebView network capture for client portal + FinanceOS + Plaid, then choose the remaining App Store labels. This is a source inventory, not a tested privacy PASS.
