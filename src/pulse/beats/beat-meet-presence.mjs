// Hourly read-only protected-door proof. No sign-in, provider request or fake client.
export const id = "meet-presence";
export const title = "Meet presence read door stays protected";
export const kind = "probe";
export const covers = ["route:read/meet-presence"];
export const checkIds = ["meet:read-door"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const steps = ["meet-read-door"];
export const damp = 2;
export const deadlineMs = 5000;
const PATH = "/api/read/meet-presence";

export async function run(ctx) {
  if (!ctx.live) {
    ctx.skipStep("meet-read-door", "The protected door is checked after this source ships; self-tests prove both outcomes.");
    return ctx.done("Meet read door needs the live release; no participant proof was made.");
  }
  await ctx.step("meet-read-door", async () => {
    const response = await ctx.http.get(`${ctx.siteUrl}${PATH}`);
    let body;
    try { body = JSON.parse(String(response?.body ?? response?.bodySnippet ?? "")); } catch { body = null; }
    if (response?.status !== 401 || body?.error !== "unauthorized") {
      throw ctx.fail("meet-read-door", "The Meet read door did not return its protected unsigned-in answer.");
    }
  });
  return ctx.done("Meet read door is protected. This does not prove a participant joined.");
}

export const fixGuide = [
  "Meet presence read door is missing or is not protected.",
  "Likely causes:",
  "- The new read route was omitted from the shipped API route table.",
  "- Authentication returned a page or exposed data instead of refusing an unsigned read.",
  "Steps:",
  "- GET the unsigned Meet read route and require status401 with the unauthorized JSON answer.",
  "- Check the route import and auth gate; preserve org and personal-call assignment checks.",
  "- Check the separate Meet connection independently. A healthy door does not prove joined participants.",
  "Files: api/read/meet-presence.mjs, netlify/functions/api.mjs, src/messaging/providers/google-meet-read.mjs, src/pulse/beats/beat-meet-presence.mjs"
].join("\n");

const scenario = status => ({ env: { NETLIFY: "true" }, http: {
  "GET https://fundhub.ai/api/read/meet-presence": { status, body: JSON.stringify({ error: status === 401 ? "unauthorized" : "not_found" }) }
} });
export const selfTest = { pass: () => scenario(401), fail: () => scenario(404) };
