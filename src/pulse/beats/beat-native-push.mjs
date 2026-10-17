// The native push door, signing setup, device ownership, and recent APNs send
// failures are checked every hour.
// A pre-deploy proof cannot read a route or table that has not shipped yet, so it
// skips these live-only steps. The self-test runs every step with a real P-256 key.
import crypto from "node:crypto";

export const id = "native-push";
export const title = "Native iPhone push is ready";
export const kind = "probe";
export const covers = ["route:push/native-device", "send:src/push/native-send.mjs"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const steps = ["signing-ready", "door-mounted", "device-owner", "recent-delivery-failure"];
export const damp = 2;
export const deadlineMs = 5000;

const PATH = "/api/push/native-device";
const SITE = "https://fundhub.ai";
const OWNERS_SQL = `
SELECT count(*)::int AS active,
       count(*) FILTER (WHERE a.id IS NULL OR a.kind NOT IN ('client', 'authorized_rep')
         OR a.status <> 'active' OR a.org_id IS DISTINCT FROM d.org_id
         OR (a.kind = 'client' AND a.client_id IS DISTINCT FROM d.client_id)
         OR (a.kind = 'authorized_rep' AND s.active_client_id IS DISTINCT FROM d.client_id)
         OR s.id IS NULL OR s.account_id IS DISTINCT FROM d.account_id
         OR s.org_id IS DISTINCT FROM d.org_id)::int AS wrong_owner,
       count(*) FILTER (WHERE d.failure_count > 0
         AND d.updated_at >= now() - interval '2 hours')::int AS recent_failed
  FROM client_apns_devices d
  LEFT JOIN accounts a ON a.id = d.account_id
  LEFT JOIN account_sessions s ON s.id = d.session_id
 WHERE d.expired_at IS NULL AND d.revoked_at IS NULL
`.trim();

function signingProblem(env) {
  if (!/^[A-Z0-9]{10}$/.test(String(env.APNS_KEY_ID || "")) ||
      !/^[A-Z0-9]{10}$/.test(String(env.APNS_TEAM_ID || ""))) {
    return "The APNs key ID or team ID is missing or invalid.";
  }
  const storageKey = Buffer.from(String(env.PUSH_SUB_ENC_KEY || ""), "base64");
  if (storageKey.length !== 32) return "The encrypted device storage key is missing or invalid.";
  try {
    const key = crypto.createPrivateKey(Buffer.from(String(env.APNS_PRIVATE_KEY_BASE64 || ""), "base64"));
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      return "The APNs signing key is not a P-256 private key.";
    }
  } catch {
    return "The APNs signing key is missing or invalid.";
  }
  return null;
}

export async function run(ctx) {
  if (!ctx.live) {
    for (const step of steps) ctx.skipStep(step, "this route and table need the live release; the self-test checks both outcomes before deploy");
    return ctx.done("Native push needs a live release before these four checks can run.");
  }

  await ctx.step("signing-ready", async () => {
    const problem = signingProblem(ctx.env);
    if (problem) throw ctx.fail("signing-ready", problem);
  });

  await ctx.step("door-mounted", async () => {
    const res = await ctx.http.get(`${ctx.siteUrl}${PATH}`);
    let body;
    try { body = JSON.parse(String(res.body ?? res.bodySnippet ?? "")); } catch { body = null; }
    if (res.status !== 401 || body?.error !== "unauthorized") {
      throw ctx.fail("door-mounted", `GET ${PATH} did not return the native route's unsigned-in answer (status ${res.status || 0}).`);
    }
  });

  let deviceRow;
  await ctx.step("device-owner", async () => {
    let row;
    try { row = (await ctx.read(OWNERS_SQL)).rows[0]; }
    catch (error) {
      throw ctx.fail("device-owner", `Native device ownership could not be read: ${String(error?.message || error).slice(0, 100)}`);
    }
    if (!row || !Number.isFinite(Number(row.active)) || !Number.isFinite(Number(row.wrong_owner))) {
      throw ctx.fail("device-owner", "Native device ownership returned no usable count.");
    }
    if (Number(row.wrong_owner) > 0) {
      throw ctx.fail("device-owner", `${row.wrong_owner} live iPhone device rows have the wrong or inactive client owner.`);
    }
    deviceRow = row;
  });

  await ctx.step("recent-delivery-failure", async () => {
    const failed = deviceRow?.recent_failed == null ? NaN : Number(deviceRow.recent_failed);
    if (!Number.isFinite(failed)) {
      throw ctx.fail("recent-delivery-failure", "The recent APNs failure count was not returned.");
    }
    if (failed > 0) {
      throw ctx.fail("recent-delivery-failure", `${failed} active iPhone devices reported an APNs send failure in the last two hours.`);
    }
  });

  return ctx.done("The native push door answers, signing is ready, device owners match, and no recent APNs failure is recorded. This does not prove a booking alert reached an iPhone.");
}

export const fixGuide = [
  "Native iPhone push is not ready. Check the step named in the text.",
  "Likely causes:",
  "- signing-ready: an APNs ID, P-256 key, or encrypted device storage key is missing from the live app.",
  "- door-mounted: the native route was not shipped, fell out of the route map, or the app cannot read sign-in state.",
  "- device-owner: the device table is missing, cannot be read, or a live row belongs to another client.",
  "- recent-delivery-failure: APNs rejected a send to a live device in the last two hours, or its receipt count could not be read.",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs native-push to see the first failed step.",
  "- Check the live environment names, the native route, and the client_apns_devices rows without printing keys or tokens.",
  "- After the route is healthy, send one approved test to an opted-in real iPhone and check that it arrives.",
  "Files: api/push/native-device.mjs, src/push/native-send.mjs, src/push/native-store.mjs, src/pulse/beats/beat-native-push.mjs, netlify/functions/api.mjs"
].join("\n");

function goodAnswers() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const encoded = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64");
  return {
    env: {
      NETLIFY: "true", APNS_KEY_ID: "A1B2C3D4E5", APNS_TEAM_ID: "F6G7H8I9J0",
      APNS_PRIVATE_KEY_BASE64: encoded, PUSH_SUB_ENC_KEY: Buffer.alloc(32, 1).toString("base64")
    },
    http: { [`GET ${SITE}${PATH}`]: { status: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) } },
    read: [{ match: /FROM client_apns_devices/, rows: [{ active: 1, wrong_owner: 0, recent_failed: 0 }] }]
  };
}

export const selfTest = {
  pass: () => goodAnswers(),
  fail: () => ({ ...goodAnswers(), read: [{ match: /FROM client_apns_devices/, rows: [{ active: 1, wrong_owner: 1, recent_failed: 0 }] }] })
};
