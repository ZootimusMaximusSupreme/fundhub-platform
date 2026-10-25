# Removed from `docs/rules/TELEPROMPTER-VIDEO.md` on 2026-10-24

Reason: D214, D215, S14, S15. D216 added the acceptance checklist from AGENTS.md. It did not cut AGENTS.md. Owner call 2026-10-13 stays on the page. Owner screen guardrail 2026-10-12 stays, except the one batch sentence.

## D214, old camera path

The locked features are in `.claude/rules/teleprompter-camera.md` (mirror: `.cursor/rules/teleprompter-camera.mdc`).

New path: `.ai/rules/teleprompter-camera.md`.

## D215, size, 60 fps, and mirror sentences

Front-camera Ads: full-frame 1080p at 30 fps. VSLs, thank-you videos, and testimonials: full-frame 4K at 30 fps. 60 fps waits for the iPhone app (owner call 2026-10-13). The front camera is saved mirrored; the back camera is not.

Meaning now: teleprompter-camera and video-4k-unless-ad. Every take is a hard 30 fps until the iPhone app (owner call 2026-10-13, still on line 5 of this page). Ads are 1080p. Other videos are 4K. Testimonial card videos on pages do not need 4K (owner-set 2026-10-24). The front camera is saved mirrored. The back camera is saved as the world looks. That back-camera sentence lives in `.ai/rules/teleprompter-camera.md`.

Kept on this page: "These are saved-file acceptance targets, not just camera requests." The failed-quality sentence. The upright-preview sentence.

## S14, one batch sentence on the 2026-10-12 screen guardrail

This batch permits the requested small actual-camera badge and the reported overlapping script-picker labels.

The rest of that owner line stayed, including the badge rule and "Never fill the badge from the selected preset".

## S15, one measured take

Measured regression (2026-10-12): the 7:18 p.m. Ad take has correct full portrait framing at 1080×1920 and no repeated frames, but averages 24.23 fps. The recorder's callback-time gate drops half of a steady 60 fps source under 1 ms callback jitter in the browser reproducer. A real WebKit encoder check also proved that live `mediaTime` can stay zero; the first proposed timestamp correction froze and its release was cancelled before publication. The correction keeps fresh Ad frames and uses advancing presentation time only when reducing a faster source. Actual iPhone output remains a required proof after release.

The lesson stays in items 7 and 8.
