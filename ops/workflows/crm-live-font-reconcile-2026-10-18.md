# Live CRM and rounded font correction
The owner reports that fundhub.ai still shows the old staff CRM and rejects the web font.
Reference source: tools/fundhub-mac/FundhubMac.swift WelcomeView uses58pt semibold system rounded (SF Pro Rounded).
Start from current main0998ff49969c6e2663a6e1851b4634ab5896113d; do not replace production with the diverged redesign branch.
The original cloud executor is offline. GitHub Actions is now the cloud build/browser runner. No local-machine switch.
First check: shared rounded type on all actual app pages, Apple system/local face where available, licensed self-hosted Nunito fallback for browsers without Apple rounded access. Apple font files are not redistributed. Partner/custom tenant fonts remain selected by existing brand payload; credentials/roles/APIs unchanged.
The cloud runner also performs a read-only three-way scan of reviewed layout changes against current production, recording conflicts and removed production IDs before integration.
No main merge or production claim until actual release checks and live-site verification. Owner has already requested publication; no renewed design-approval gate.
The earlier61-page manifest/page-builder ownership remains. This is shared typography and integration work, not a second page builder. Nine completed page results remain in the disconnected original worktree,22unfinished pages remain; do not mark the full redesign complete.
