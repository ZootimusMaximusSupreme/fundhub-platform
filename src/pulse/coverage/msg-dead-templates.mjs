// The message templates nothing sends — the list behind the "nothing to judge" row msg:dead-senders.
//
// Source: ops/workflows/coverage-every-surface-2026-10-10/messages.json (one row per template, read from the
// repo on 2026-10-10 by searching src/, api/, netlify/ and scripts/ for every literal and prefix builder).
// A key is on this list only when that row's trigger line says one of:
//   no-sender   "no sender in src/, api/, netlify/, scripts/": no code path queues it
//   doc-source  "doc source copy for alias(es) ...; nothing sends this key itself": the document seed copy
//   retired     "retired / dormant": the owner or the code turned it off, and no send site is left
//
// 158 keys: 118 no-sender, 23 doc-source, 17 retired. That matches the board's own count of 158 dead message
// templates. (The board's per-channel lines say 141 no-sender and 51 retired. That does not add up from the file's
// trigger lines, so the list follows the trigger lines. A template that has a sender is never on this list; the
// bad-copy row of the gap-sms lane watches the ones that hold unfinished copy.)
//
// WHAT THE LANE DOES WITH IT. gap-msg.mjs reads the messages table. If any key on this list has been queued
// in the last 7 days, msg:dead-senders goes red and names the key: the claim "nothing sends this" is wrong,
// so the template needs the checks a live one has. If none was queued, the row says "nothing to judge" with
// the code no-sender (src/pulse/na-conditions.mjs), and the audit re-reads the table every morning.
//
// WHEN YOU BUILD A SENDER FOR ONE OF THESE KEYS: remove the key from this list in the same change. Leaving
// it here is what makes the day-one red honest.
//
// This file holds data only. No repo file is read at run time (a folder scan ships empty on the server).

export const DEAD_TEMPLATES = Object.freeze({
  "no-sender": Object.freeze([
    "AF", "AF-06", "AF2", "AF3", "AF4", "AR-PP1", "AR-PP2", "AR-PP3", "AR-PP4", "AR-PP5", "AR-PP6", "AR1",
    "AR2", "AR3", "AR4", "BS-EMAIL-FUNDING-72HR", "BS-EMAIL-REPAIR-72HR", "Begin LT-Cold-2", "Begin LT-Cold-3.",
    "C3", "D1", "D2", "D3", "D4", "Default - Document Sent", "F-06--2", "F1", "F2", "F3", "FC2", "FC3", "FR1",
    "FR10", "FR11 - Round 5 Approvals", "FR12 - Round 6 Submitted", "FR13", "FR14", "FR15", "FR16", "FR17",
    "FR18", "FR19", "FR2", "FR20", "FR21", "FR23", "FR3", "FR4", "FR5", "FR6", "FR7", "FR8", "FR9", "Fundhub",
    "GE1", "GE2", "GE3", "LT-Cold- 2", "LT-Hot-2", "LT-Hot-3", "LT-Warm-1", "LT-Warm-3", "N-05", "N-07", "N-08",
    "NS3", "OA1", "OA2", "P1", "P3", "PC1", "PC2", "PC3", "PC4", "PCR1", "PCR2", "PCR3", "PCR4", "R-02", "R-03",
    "R-05", "R-06", "R-07", "R-09", "R-10", "RC1", "RC2", "RER1", "RER2", "RER3", "RNS1", "RNS2", "RNS3", "RP1",
    "RP2", "RP3", "S-01 New Lead Intake", "S-03 Incomplete Booking", "S-04", "S-04B Reminder Email",
    "S-05 No-Show Recovery", "S-06 Application Push", "S-07 Sales Status Cleanup", "S-08", "S2",
    "SMS-BLK-01-NEW-NEGATIVE-PAUSED", "SMS-BS01-01-CONFIRMATION-HUB", "SMS-BS01-02-PRECALL-NUDGE",
    "SMS-F02-02-PORTAL-ID-FOLLOWUP", "SMS-R00-01-REPAIR-ROUND-SENT", "SMS-R12-01-UPGRADE-INVITE",
    "SMS-R13-01-WELCOME-TO-FUNDING", "SMS-S05-01-NOSHOW", "SMS-S05-02-NOSHOW-NUDGE", "T1", "T2", "T3", "U-06"
  ]),
  "doc-source": Object.freeze([
    "DPC-05", "F-02", "F-03", "F-04", "F-06", "F-10", "FR22", "N-01", "N-02", "N-03", "N-04", "N-06", "P2",
    "S-02", "SEND AX-07", "SMS-F02-01-PORTAL-ID", "SMS-F03-01-ROUND-SUBMITTED", "SMS-F04-01-ROUND-MOVEMENT",
    "SMS-F06-01-MISSING-DOCS", "SMS-F07-01-LOC", "SMS-F10-01-INBOX-READY", "U-02", "U-02--2"
  ]),
  retired: Object.freeze([
    "EMAIL-C06-DECLINE", "EMAIL-DOC-02-REQUEST-MORE", "EMAIL-F10-INBOX-SETUP", "EMAIL-N01-COLD-NURTURE",
    "EMAIL-N02-WARM-NURTURE", "EMAIL-N03-HOT-NURTURE", "EMAIL-SLO-GENUINE-02",
    "EMAIL-U02-ANALYZER-REPAIR-DELIVERY", "SMS-BS01-01-BOOKED", "SMS-BS01-03-DAYOF", "SMS-C06-DECLINE",
    "SMS-F10-INBOX-SETUP", "SMS-N01-COLD-NURTURE", "SMS-N02-WARM-NURTURE", "SMS-N03-HOT-NURTURE", "SMS-SLO-DIG",
    "SMS-SLO-GENUINE-02"
  ])
});

/** Every dead key, once, in a stable order. */
export const DEAD_TEMPLATE_KEYS = Object.freeze(
  [...new Set([...DEAD_TEMPLATES["no-sender"], ...DEAD_TEMPLATES["doc-source"], ...DEAD_TEMPLATES.retired])].sort()
);
