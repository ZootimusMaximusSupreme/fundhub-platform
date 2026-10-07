// One text from the live site, where the Twilio keys are real.
// A GET does nothing. A POST sends only when the nonce matches.
import { send } from "../../src/messaging/providers/twilio.mjs";

const BODY = "Teleprompter update is live. Reload the film link. No word underline. Bottom fades in portrait. Volume buttons change speed where the phone allows it.";

export default async function handler(req) {
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
