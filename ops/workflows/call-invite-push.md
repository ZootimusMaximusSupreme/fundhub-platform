# Call-invite push slice

- Owner: `/root/call_invite_builder`; branch `codex/call-invite-push` from PR #63 head `9d9c826d8c38b6be605596d81c8ff7d832566b24`.
- Source: matching sent handoff SMS, current single booking, true HTTPS meeting link, 15-minute pre-call window, bounded APNs expiry, authenticated fresh Join Call read.
- Local checks: 91 focused Node tests; 6 Playwright tests at 1440px/390px; TypeScript and lint passed.
- Evidence: `ops/workflows/build-evidence/call-invite-push/1440-full.png` and `390-full.png`, both marked.
- Release gate: not pushed, merged, or deployed by this slice. Real iPhone APNs banner and current-link tap remain unproved.
