# Fundhub product HTML export

Packaging-only agent: `/root/fundhub_html_packaging`, started after final integrated source checkpoint. No app files changed.

- Source branch: `codex/client-portal-ios-redo`
- Review source commit: `e5a3d786600396a1ce8c3b9912bdfe0549326d9d` (PR #67)
- Exact local source snapshot: `055b58606752c4045dee639897580b5cbc576980`; source bytes equivalent to the uploaded review commit.
- Downloadable ZIP: `fundhub-product-html-review.zip`, 8,573,480 bytes; delivered as a persistent chat artifact.
- SHA256: `1c59ffdec170a1c4961a8aa74bb61001c017a6224e3020d52db38cc303e3bdbd`
- 803 original source files, including 79 HTML; 165 HTML excluded. README and complete MANIFEST.json are inside the archive in addition to original source files.

Every one of 244 tracked HTML paths has an explicit inclusion/exclusion reason in the manifest. Included: Fundhub CRM/app pages, staff tools, client portal, FinanceOS, affiliate/referral, auth, agreement/signature, progress, course viewer, legal pages, climate dashboard, the functional optimize-plan credit-roadmap deliverable, and post-purchase roadmap/pull soft-pull consent/fulfillment. Excluded: marketing/acquisition funnels including root optimize acquisition and roadmap sales/checkout, education sales/enrollment application, partner/white-label offer pages, other brands/vendor test apps, mocks, evidence, reports, uploads/exports/recordings and large media. Existing app tools for managing marketing remain app tools; their funnel HTML is absent.

Local CSS/JS/modules/icons/assets are retained with original structure, including dynamic app-module namespace, lender icons, and climate chunks. Original source bytes are unchanged. Reopened ZIP validation checks all source hashes and relative-path safety, and confirms packaged HTML exactly matches the allowlist. Private-key/common service-token scan and hardcoded credential-candidate scan found no selected-file matches. No account data or production credentials were read or included.

Runtime dependencies remain: authorized Fundhub backend/API/session/roles, third-party services and external fonts/CDN libraries. Static file opening cannot reproduce authenticated live behavior. Manifest records unresolved static references: existing absent `public/vendor/pdfjs/pdf.worker.mjs`; `public/funnel/fh-attribution.js` and `public/funnel/rb2b.js` intentionally excluded as funnel tracking assets. Links to omitted destinations remain unchanged in original files. This export is not a production release.
