// Beat: text-path. Is a text to a client able to leave?
//
// Chris's real failure #3: "a client didn't receive a text message."
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md): READ ONLY. This beat sends nothing
// and queues nothing. It proves the send path is alive from the data the path leaves behind.
// The steps, the SQL and the rules live in ./lib/send-path.mjs and are shared with email-path.
//
// What this cannot prove: that a phone got a text today. That needs a real send (the
// text-canary, an open decision for Chris). It proves every piece we own is awake: the
// switches, the approved copy, the sweeper, the line, the failures, the receipts.

import { TEXT_PATH, TEXT_STEPS, runSendPath, fakeReads } from "./lib/send-path.mjs";

export const id = "text-path";
export const title = "Text messages to clients";
export const kind = "send";
export const covers = ["job:message-dispatch-sweeper"];
export const box = false;
export const reads = [];
export const steps = [...TEXT_STEPS];
// 12 s is the most a beat may have. Each read is 3 round trips on the one shared connection and all
// the beats run at once (about 24 reads). Measured 3.4 to 3.9 s on a laptop; Netlify is farther from
// the database, so the old 8 s left too little room and one slow hour would have texted Chris.
export const deadlineMs = 12000;
export const damp = 1;

export const fixGuide = [
  "Texts to clients may not be leaving. Check the send switch, the sweeper and the Twilio setup.",
  "",
  "Likely causes:",
  "- The company send switch is off, the sms route is off, or MESSAGING_DRY_RUN is not set to an off value (shows at fence-open).",
  "- A launch text was set back to not approved, or holds lorem ipsum or a [DRAFT] mark (shows at template-ready).",
  "- The message-dispatch-sweeper stopped running (shows at dispatcher-alive). A sweeper that runs but fails inside every pass does not show there; it shows at queue-moving after 15 minutes, when something is waiting.",
  "- Our own sender refused the messages: the compliance gate broke, or a launch message holds placeholder copy (shows at failures-recent as refused; read blocked_reason or last_error on the blocked rows).",
  "- Twilio refuses the key, or the A2P registration is not approved, so texts wait in the line or fail (shows at queue-moving and failures-recent).",
  "- The opt-out list cannot be read, so the sender cannot check who said STOP (shows at opt-out-readable).",
  "Steps:",
  "- Open https://fundhub.ai/app/ops-admin.html and check the send switch is on. Check MESSAGING_DRY_RUN on Netlify is set to 0.",
  "- Open the message-dispatch-sweeper in Inngest and read its last runs. Check INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are set.",
  "- Read last_error on the stuck or failed text rows. A Twilio error code names the cause. Set a good Twilio key on Netlify; never delete the old one first.",
  "- Run node scripts/pulse/run-beat.mjs text-path and read the step it stops at.",
  "- This beat reads the line and sends nothing. A green beat does not prove a text landed on a phone.",
  "Files: src/messaging/dispatch.mjs, src/workflows/message-dispatch-sweeper.mjs, src/messaging/providers/twilio.mjs, src/lib/dry-run.mjs"
].join("\n");

export async function run(ctx) {
  return runSendPath(ctx, TEXT_PATH);
}

export const selfTest = {
  pass: () => ({ read: fakeReads(TEXT_PATH) }),
  fail: () => ({
    read: fakeReads(TEXT_PATH, {
      queue: { queued_n: 2, oldest_queued: new Date("2026-10-09T18:20:00.000Z"), sample_error: "Twilio 30034: message blocked" }
    })
  })
};
