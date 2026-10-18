# Consent capture — inventory correction

`public/app/consent-capture.html` is excluded from actual client-facing page builders. The client portal intentionally captures client dispute signatures inline; its explicit STAFF ONLY comment (around line 580) matches the shell role boundary. Client visits to this staff consent desk bounce to the client portal. This is compatibility behavior to preserve, not a missing client page.

All experimental page changes, page CSS and new browser spec were removed by this page agent. The staff page remains byte-identical to HEAD. No shared shell/API changes were made. No screenshots were retained as approved redesign evidence for this excluded page.

Discovery inventory: four separate consent kinds; server disclosure/version/status/history GET; typed/checkbox/signature with required name and drawn ink; clear canvas; expiry; grant POST; withdrawal reason and revoke POST; no disclosure and API errors disable/describe capture; staff return link carries client_id. The API verifies ownership for client principals, but that does not make the staff HTML an intended client journey.

Verification: existing e2e/consent-capture-clicks.spec.mjs and e2e/consent-capture-kinds.spec.mjs: 17 browser tests passed in cloud Chromium. Temporary role test additionally confirmed original staff return link and absence of client theme. Three exploratory client tests exposed the intentional shell redirect; they were removed after journey correction, not relabeled as successful client page proof. No database write or persistence claim. All browser endpoints used safe mocked data.
