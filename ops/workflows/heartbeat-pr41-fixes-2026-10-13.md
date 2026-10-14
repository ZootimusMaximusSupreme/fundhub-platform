# PR #41 Claude fixes — 2026-10-13

Branch: `codex/pr41-claude-fixes-local`
PR: #41

## Work lanes

- [x] Rebase on `origin/main`; five proof-test conflicts resolved.
- [x] Display lane: 1,093 unmeasured display rows report `NOT_PROVED`; only measured query results can report `FAIL`.
- [x] Audit lane: each started N/A check gets its own 2.5 second limit, with a 15 second hard stop for the lane. Stale answers stay `FAIL`; unread and timed-out answers stay visible as `skip`.
- [x] Remove `public/app/agent-editor.html` and its matching e2e-only timeout change from this PR.
- [x] Safe checks used `env -u DATABASE_URL`. Focused integration passed 227/227; lint and TypeScript are clean; the exact display meta-test passed 3/3 alone after one duplicate-load failure in the full suite.
- [ ] Update the build manifest, commit, push the review branch, and update draft PR #41.

## Production-data hold

Do not alter the 116 fake clients or 21 fake funding rounds from October 11–12. Chris decides what happens to them.
