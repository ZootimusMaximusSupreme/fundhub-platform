// The client-facing progress timeline, and the one thing it may never say:
// R4 AND R5 MUST NEVER APPEAR AS FILED.
//
// THE TIMELINE LIVES IN src/pulse/beats/lib/progress-timeline.mjs (2026-10-20), moved whole and
// unchanged with its reads (lib/repair-signals.mjs) and renderer (lib/repair-lens.mjs), so the hourly
// pulse runs the same progress read the client's page runs (a beat may import only from the beat
// library). The full design note — the allowlist, the load-time scrub, the events milestones — is at
// the top of that file. Every caller imports from here as before: claimsFiled, NEUTRAL_WORDS,
// allowlistFrom, TIMELINE_WORDS, KNOWN_DECISIONS, EVENT_WORDS, TIMELINE_EVENT_NAMES, eventLine,
// approvedWords, progressLine, progressTimeline. timeline.test.mjs still holds both layers.

export * from "../pulse/beats/lib/progress-timeline.mjs";
