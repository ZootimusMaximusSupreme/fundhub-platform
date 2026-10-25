# Pulse registry — same change as the feature

**Owner law (2026-08-25):** Every new live thing is watched. No “we’ll monitor later.”

Superseded by `heartbeat-on-every-build` (owner-set 2026-10-07, widened 2026-10-09). Read that file.

The short form: every new live page, routed `api/` handler, Inngest job or outbound send path gets a `PULSE_REGISTRY` row in `src/pulse/registry.mjs` in the same change. The 6:00 a.m. (Arizona) morning pulse reads that list. The pulse only reports. It never auto-fixes.
