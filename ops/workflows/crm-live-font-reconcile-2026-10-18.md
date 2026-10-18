# Live CRM and rounded font correction
The owner reports that fundhub.ai still shows the old staff CRM and rejects the web font.
Reference source: tools/fundhub-mac/FundhubMac.swift WelcomeView uses58pt semibold system rounded (SF Pro Rounded).
Start from current main0998ff49969c6e2663a6e1851b4634ab5896113d; do not replace production with the diverged redesign branch.
The original cloud executor is offline. GitHub Actions is now the cloud build/browser runner. No local-machine switch.
First check: shared rounded type on all actual app pages, Apple system/local face where available, licensed self-hosted Nunito fallback for browsers without Apple rounded access. Apple font files are not redistributed. Partner/custom tenant fonts remain selected by existing brand payload; credentials/roles/APIs unchanged.
The cloud runner also performs a read-only three-way scan of reviewed layout changes against current production, recording conflicts and removed production IDs before integration.
No main merge or production claim until actual release checks and live-site verification. Owner has already requested publication; no renewed design-approval gate.
The earlier61-page manifest/page-builder ownership remains. This is shared typography and integration work, not a second page builder. Nine completed page results remain in the disconnected original worktree,22unfinished pages remain; do not mark the full redesign complete.

## Short checkpoint — staff publication recovery
- Production remains main0998ff49969c6e2663a6e1851b4634ab5896113d. No staff-redesign production release is claimed.
- PR71 is based on production, preserving newer production changes. Rounded type assets and61page inclusions are committed. SF Pro Rounded uses native/local access; licensed self-hosted Nunito is the fallback.
- Six reviewed staff pages plus shared navigation/header merged cleanly in cloud: Pipeline, Sales workspace, Calendar, Client workspace, Documents, Messaging. No production HTML IDs were lost. New assets are now explicitly included in persistence.
- Latest full integration proof: lint+TypeScript passed;680source checks passed,2failed;97browser checks passed,2failed. Fixes are queued for obsolete global-font/topbar/clock assertions;320px portal overflow is still a real unresolved layout defect. New actual-rendered-glyph proof is queued.
- Six original page owners are recovering their completed work into separate codex/recover-* branches: My numbers, staff FinanceOS, Sales floor, Client success, Lenders, Contract templates. They remain the sole builders for those pages. No duplicate agents.
- Overall historical manifest:39of61page implementations completed,22unfinished. Nine completed outputs were not pushed before the old executor disconnected; recovery is underway. Prior page passes do not certify the new integrated release.
- Executor remains offline; GitHub tools and GitHub Actions provide working cloud source/build/browser access. No owner action required.
- Next: finish current failures, integrate recovered staff pages, run their feature checks, then use the existing main Ship workflow and verify actual fundhub.ai URLs. Client layout still needs the owner's revised Mac-style direction; no full-redesign completion claim.
