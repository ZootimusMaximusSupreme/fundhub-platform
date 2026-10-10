// Beat: email-path. Is an email to a client able to leave?
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md): READ ONLY. This beat sends nothing
// and queues nothing. It proves the send path is alive from the data the path leaves behind.
// The steps, the SQL and the rules live in ./lib/send-path.mjs and are shared with text-path.
// It adds one step the text beat does not have: the unsubscribe secret (live server only).
//
// What this cannot prove: that an inbox got an email today. That needs a real send.
// It proves every piece we own is awake: the switches, the approved copy, the sweeper,
// the line, the failures, the receipts, and the secret that signs the unsubscribe link.

import { EMAIL_PATH, EMAIL_STEPS, runSendPath, fakeReads } from "./lib/send-path.mjs";

export const id = "email-path";
export const title = "Emails to clients";
export const kind = "send";
export const covers = ["job:message-dispatch-sweeper"];
export const box = false;
export const reads = [];
export const steps = [...EMAIL_STEPS];
// 12 s is the most a beat may have. Each read is 3 round trips on the one shared connection and all
// the beats run at once (about 24 reads). Measured 3.4 to 3.9 s on a laptop; Netlify is farther from
// the database, so the old 8 s left too little room and one slow hour would have texted Chris.
export const deadlineMs = 12000;
export const damp = 1;

export const fixGuide = [
  "Emails to clients may not be leaving. Check the send switch, the sweeper and the Resend setup.",
  "",
  "Likely causes:",
  "- The company send switch is off, the email route is off, or MESSAGING_DRY_RUN is not set to an off value (shows at fence-open).",
  "- A launch email was set back to not approved, or holds lorem ipsum or a [DRAFT] mark (shows at template-ready).",
  "- The message-dispatch-sweeper stopped running (shows at dispatcher-alive). A sweeper that runs but fails inside every pass does not show there; it shows at queue-moving after 15 minutes, when something is waiting.",
  "- Our own sender refused the messages: the compliance gate broke, or a launch message holds placeholder copy (shows at failures-recent as refused; read blocked_reason or last_error on the blocked rows).",
  "- Resend refuses the key, or the sending domain is not verified, so emails wait in the line, fail or bounce (shows at queue-moving and failures-recent).",
  "- UNSUBSCRIBE_TOKEN_SECRET is missing, a mask or under 32 characters, so emails go out with no unsubscribe link (shows at unsubscribe-secret).",
  "Steps:",
  "- Open https://fundhub.ai/app/ops-admin.html and check the send switch is on. Check MESSAGING_DRY_RUN on Netlify is set to 0.",
  "- Open the message-dispatch-sweeper in Inngest and read its last runs. Check INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are set.",
  "- Read last_error on the stuck, failed or bounced email rows. Check the domain in Resend is verified and set a good key on Netlify; never delete the old one first.",
  "- Set UNSUBSCRIBE_TOKEN_SECRET on Netlify to 64 random hex characters (without --secret), then ship once.",
  "- Run node scripts/pulse/run-beat.mjs email-path and read the step it stops at.",
  "- This beat reads the line and sends nothing. A green beat does not prove an email landed in an inbox.",
  "Files: src/messaging/dispatch.mjs, src/workflows/message-dispatch-sweeper.mjs, src/messaging/providers/resend.mjs, src/messaging/unsubscribe.mjs, src/lib/dry-run.mjs"
].join("\n");

export async function run(ctx) {
  return runSendPath(ctx, EMAIL_PATH);
}

export const selfTest = {
  pass: () => ({ read: fakeReads(EMAIL_PATH) }),
  fail: () => ({
    read: fakeReads(EMAIL_PATH, {
      queue: { queued_n: 2, oldest_queued: new Date("2026-10-09T18:20:00.000Z"), sample_error: "Resend: domain is not verified" }
    })
  })
};
