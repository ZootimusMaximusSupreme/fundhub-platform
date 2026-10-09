// One text from the live site, where the Twilio keys are real.
// A GET does nothing. A POST sends only when the nonce matches.
// The number below is Chris's own phone, so texting hours apply (owner law 2026-10-09,
// .claude/rules/texting-hours.md): outside 6 a.m. to 10 p.m. Arizona time nothing is sent and the
// answer is 202 { status: "held_quiet_hours" }. context.now() is the clock (tests); default: the real clock.
import { send } from "../../src/messaging/providers/twilio.mjs";
import { inTextWindow, HELD } from "../../src/pulse/quiet-hours.mjs";

const BODY = "Teleprompter update is live. Reload the film link. No word underline. Bottom fades in portrait. Volume buttons change speed where the phone allows it.";

export default async function handler(req, context) {
  const now = context && typeof context.now === "function" ? context.now : () => new Date();
  if (!req || req.method !== "POST") return new Response("no", { status: 404 });
  let nonce = "";
  try {
    const url = new URL(req.url);
    nonce = url.searchParams.get("n") || "";
  } catch {
    nonce = "";
  }
  const expect = String(process.env.TELEPROMPTER_TEXT_NONCE || "");
  if (!expect || nonce !== expect) return new Response("no", { status: 404 });
  if (!inTextWindow(now())) {
    return new Response(JSON.stringify({ status: HELD }), {
      status: 202,
      headers: { "content-type": "application/json" }
    });
  }
  const res = await send(
    { to: "+14808656457", channel: "sms", body: BODY },
    { env: process.env }
  );
  const sent = res && res.status === "sent";
  return new Response(JSON.stringify({ status: res && res.status }), {
    status: sent ? 200 : 502,
    headers: { "content-type": "application/json" }
  });
}
