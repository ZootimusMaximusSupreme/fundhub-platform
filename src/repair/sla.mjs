// SLA clocks → stalled. Spec CREDIT-REPAIR-PIPELINE-SPEC §5.
//
// THE CLOCKS LIVE IN src/pulse/beats/lib/repair-sla.mjs (2026-10-20). That file already held a word-for-word
// copy for the repair beats; it is now the ONE copy, so the desk's Stuck chip, the SLA sweeper, the progress
// timeline and the hourly beats read the same clocks (a beat may import only from the beat library). Every
// caller imports from here as before: STAGE_SLA, isBreached, STALLED_STAGE. Change the clocks there.

export * from "../pulse/beats/lib/repair-sla.mjs";
