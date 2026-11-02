import { meetConnectionStatus } from "../../messaging/providers/google-meet-read.mjs";

// Configuration tripwire only. A configured connection never proves a person
// joined; the scoped read route and real provider receipt supply that evidence.
export async function gapChecks(ctx = {}) {
  const config = meetConnectionStatus(ctx.env ?? process.env);
  return [{ id: "meet:readonly-connection", status: config.ready ? "PASS" : "FAIL",
    detail: config.ready ? "Separate Meet read-only connection is configured. This is not joined-participant proof."
      : `Meet presence is unavailable: ${config.reason}. Calendar time, RSVP and clicks are not presence.`,
    suggestedFix: config.ready ? null : "Connect the host with the separate Meet read-only credential; preserve working Gmail/Drive/Calendar credentials." }];
}
