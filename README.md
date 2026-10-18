# Gemini: readable CRM source

If an importer presents the repository as a binary ZIP, use **Fundhub-CRM-HTML-CSS.txt** instead. It is uncompressed UTF-8 text with all 79 HTML pages and all 47 CSS files, each identified by original path, SHA256 and byte count. Every source section was checked against the original package. No source code was rewritten. The individual HTML/CSS/JS/assets are also retained in their original public/ paths.

Upload that .txt file directly to Gemini, or open the individual source files in public/app/ and public/crm.html. For a single-page pass, start with public/app/client-control-panel.html or public/app/pipeline.html and their referenced CSS. Preserve existing IDs, scripts, API calls, role gates and conditional states. The plain-text layout bundle intentionally omits separate JS modules and image/font bytes; those remain alongside the original files in this branch, and the existing backend remains in PR67. Do not treat absent backend contents in the text bundle as missing product functionality.

---

# Fundhub CRM/app HTML package

Source branch: codex/client-portal-ios-redo
Review source commit: e5a3d786600396a1ce8c3b9912bdfe0549326d9d
Exact local source snapshot: 055b58606752c4045dee639897580b5cbc576980
Review PR: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/67

This is an exact-byte export of production Fundhub CRM/app HTML and related product, auth, agreement/signature, course-access, credit-roadmap deliverable, post-purchase soft-pull consent/pack fulfillment, dashboard, and legal UI. It includes staff tools as well as client pages. It is a review source package, not a production deployment or an offline account database. Directory structure is preserved. Use public/ as the web root in an existing authorized Fundhub runtime.

Start with public/app/client-portal.html, public/portal-login.html, public/app/financeos.html, or public/app/index.html. Authentication, API routes, roles, storage, uploads/downloads, signatures, payments, bank connections, notifications and data depend on the existing Fundhub backend and an authorized account. Opening HTML from file:// is insufficient for module imports, root-relative assets, service workers and API requests. External fonts/CDN libraries and third-party integrations still require network access. No API credentials, environment configuration, server implementation, customer exports/uploads or recordings are included. Do not use real money or customer actions as preview tests.

All marketing/sales acquisition funnels, funnel landing/checkout flows (including optimize acquisition and roadmap sales/checkout flows), partner/white-label offer pages, other brands/vendor test apps, design mocks, screenshots and reports are excluded. Existing links from retained CRM tools to these excluded destinations remain unchanged; that does not add their pages to this archive. Fundhub app tools that manage marketing remain included as CRM tools, without their funnel HTML content. Existing runtime links and dynamically chosen assets may require the original deployment; the manifest lists unresolved static asset candidates and external references.

MANIFEST.json lists every tracked HTML path, inclusion/exclusion reasons, all packaged source paths and SHA256 hashes, source identity and file counts. Every packaged source byte was compared with the exact integrated git snapshot. The ZIP was reopened and verified for safe relative paths, original-source hashes, and exclusion of all unapproved HTML. Private key/common service-token scanning passed; this is a source-only package with no live account data.

