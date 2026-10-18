# Live CRM and rounded font correction
The owner reports that fundhub.ai still shows the old staff CRM and rejects the web font.
Reference source: tools/fundhub-mac/FundhubMac.swift WelcomeView uses58pt semibold system rounded (SF Pro Rounded).
Start from current main0998ff49969c6e2663a6e1851b4634ab5896113d; do not replace production with the diverged redesign branch.
The original cloud executor is offline. GitHub Actions is now the cloud build/browser runner. No local-machine switch.
First check: shared rounded type on all actual app pages, Apple system/local face where available, licensed self-hosted Nunito fallback for browsers without Apple rounded access. Apple font files are not redistributed. Partner/custom tenant fonts remain selected by existing brand payload; credentials/roles/APIs unchanged.
The cloud runner also performs a read-only three-way scan of reviewed layout changes against current production, recording conflicts and removed production IDs before integration.
No main merge or production claim until actual release checks and live-site verification. Owner has already requested publication; no renewed design-approval gate.
The earlier61-page manifest/page-builder ownership remains. This is shared typography and integration work, not a second page builder. Nine completed page results remain in the disconnected original worktree,22unfinished pages remain; do not mark the full redesign complete.

## Short checkpoint — integrated source, before live publication

- Live publication is NOT complete. Owner authorized production release; no further owner action is required.
- PR71 now contains all24 professional client pages plus six reviewed staff pages and the shared staff navigation/header, based on current main0998ff4. The client integration merged78files; no production HTML IDs were lost.
- Current lint and TypeScript checks pass. The prior shared/source run passed682checks. The full combined client/staff browser run is in progress, followed by Money controls and phone performance. The tenant branding preservation change has a dedicated queued regression check.
- Real fresh PostgreSQL referral/demo proof and the app-role guard passed with no database skips. Successful real referral assignment persists the client's own Affiliate Dashboard through refresh and fresh sign-in; forged affiliate queries remain refused. client@fundhub.ai is the exact designated sample account, isolated by verified account/org/client linkage and fixture master sentinel. chris@ remains owner. Ordinary clients and real records are unchanged.
- Actual macOS Chrome typography was tested. Chrome renders the licensed self-hosted Nunito rounded fallback; native SF Pro Rounded was not exposed to Chrome. Apple ui-rounded is preferred when available. Safari native rendering is not yet independently verified. Do not describe the Chrome fallback as the exact native face.
- Six original page owners are recovering their already-completed staff pages: My Numbers, staff FinanceOS, Sales floor, Client success, Lenders and Contracts. No duplicate page builders were created. Their page-only commits are still awaited before final integration.
- Historical page manifest remains39of61individual implementations completed,22unfinished. Nine of those completed outputs were stranded in the disconnected original executor. This is not a61-page completion claim.
- Release preflight: real runtime DB guard passed3/3 as fundhub_app. Existing read-only pulse gate fails because GET portal-login and morning-brief time out around8seconds, exceeding existing latency limits. Missing existing message templates/FinanceOS price are reported separately. No invented prices, migrations, sends or bank actions.
- Cloud executor remains offline; GitHub source tools and GitHub Actions provide working cloud build/browser access. Next: finish current browser failures, integrate recovered staff pages, diagnose read-only release latency, run Ship to live, and verify actual fundhub.ai pages.
- After final integrated checkpoint: one NEW separate packaging agent must regenerate the Fundhub-only HTML/assets ZIP, exclude funnels/other brands/secrets, and provide manifest/checksum/downloadable artifact. Old package is not the final integrated release.
