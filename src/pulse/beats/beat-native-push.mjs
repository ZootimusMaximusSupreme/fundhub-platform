// Marketing push choices, the native push door, signing setup, device ownership,
// and recent APNs send failures are checked every hour.
// A pre-deploy proof cannot read a route or table that has not shipped yet, so it
// skips these live-only steps. The self-test runs every step with a real P-256 key.
import crypto from "node:crypto";
import { BOARD_CARDS_SQL, BOARD_READ_LIMIT, orgDemoModeEnabled } from "./lib/pipeline-boards-truth.mjs";

export const id = "native-push";
export const title = "Native iPhone push is ready";
export const kind = "probe";
export const covers = ["route:push/native-device", "route:push/preferences", "send:src/push/native-send.mjs", "route:native/client-activity"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const steps = ["preference-door", "preference-shape", "signing-ready", "door-mounted", "device-owner", "recent-delivery-failure", "native-open-receipts"];
export const checkIds = ["crm-data:pipeline"];
export const damp = 2;
export const deadlineMs = 5000;

const PATH = "/api/push/native-device";
const PREFERENCE_PATH = "/api/push/preferences";
const SITE = "https://fundhub.ai";
const DEFAULT_ORG_SQL = "SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1";
export const NATIVE_APP_OPENS_SQL = `
  SELECT client_id, MIN(first_authenticated_at) AS first_authenticated_at
    FROM native_client_app_opens
   WHERE org_id = $1 AND platform = 'ios' AND client_id = ANY($2::uuid[])
   GROUP BY client_id
`;
const PREFERENCE_SQL = `
SELECT count(*)::int AS invalid_preferences
  FROM clients
 WHERE custom_fields ? 'marketing_push_enabled'
   AND jsonb_typeof(custom_fields -> 'marketing_push_enabled') <> 'boolean'
`.trim();
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
    return ctx.done("Push needs a live release before these checks can run.");
  }

  await ctx.step("preference-door", async () => {
    const res = await ctx.http.get(`${ctx.siteUrl}${PREFERENCE_PATH}`);
    let body;
    try { body = JSON.parse(String(res.body ?? res.bodySnippet ?? "")); } catch { body = null; }
    if (res.status !== 401 || body?.error !== "unauthorized") {
      throw ctx.fail("preference-door", `GET ${PREFERENCE_PATH} did not return the unsigned-in answer (status ${res.status || 0}).`);
    }
  });

  await ctx.step("preference-shape", async () => {
    let row;
    try { row = (await ctx.read(PREFERENCE_SQL)).rows[0]; }
    catch (error) {
      throw ctx.fail("preference-shape", `Marketing push choices could not be read: ${String(error?.message || error).slice(0, 100)}`);
    }
    const invalid = row?.invalid_preferences == null ? NaN : Number(row.invalid_preferences);
    if (!Number.isFinite(invalid)) {
      throw ctx.fail("preference-shape", "The saved marketing push choice count was not returned.");
    }
    if (invalid > 0) {
      throw ctx.fail("preference-shape", `${invalid} client marketing push choices are not saved as true or false.`);
    }
  });

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

  await ctx.step("native-open-receipts", async () => {
    try {
      const orgId = (await ctx.read(DEFAULT_ORG_SQL)).rows[0]?.id;
      if (!orgId) throw new Error("The default company was not returned.");
      const db = { query: (sql, params) => ctx.read(sql, params) };
      const demoOn = await orgDemoModeEnabled(db, orgId);
      const cards = (await ctx.read(BOARD_CARDS_SQL, ["sales", orgId, BOARD_READ_LIMIT, demoOn])).rows;
      if (!Array.isArray(cards)) throw new Error("The Sales card read returned no rows collection.");
      const clientIds = [...new Set(cards.map((card) => card.client_id).filter(Boolean))];
      const receipts = (await ctx.read(NATIVE_APP_OPENS_SQL, [orgId, clientIds])).rows;
      if (!Array.isArray(receipts)) throw new Error("The native receipt read returned no rows collection.");
      const saved = new Map(receipts.map((receipt) => [String(receipt.client_id), receipt.first_authenticated_at]));
      for (const card of cards) {
        if (!card.client_id) continue;
        const expected = saved.get(String(card.client_id));
        const shown = card.app_first_authenticated_at;
        if (expected == null && shown == null) continue;
        if (expected == null || shown == null || !Number.isFinite(new Date(expected).getTime()) ||
            new Date(expected).getTime() !== new Date(shown).getTime()) {
          throw new Error("A visible Sales card does not match its saved native app-open receipt.");
        }
      }
    } catch (error) {
      throw ctx.fail("native-open-receipts", `Native app-open proof failed: ${String(error?.message || error).slice(0, 160)}`);
    }
  });

  return ctx.done("Push doors answer, choices are boolean, signing and device owners match, no recent APNs failure is recorded, and visible Sales cards match saved app-open receipts. This does not prove an iPhone banner or signed-in device journey.");
}

export const fixGuide = [
  "Native iPhone push is not ready. Check the step named in the text.",
  "Likely causes:",
  "- preference-door: the marketing choice route was not shipped or no longer requires client sign-in.",
  "- preference-shape: saved marketing choices contain a value other than true or false, or the clients table cannot be read.",
  "- signing-ready: an APNs ID, P-256 key, or encrypted device storage key is missing from the live app.",
  "- door-mounted: the native route was not shipped, fell out of the route map, or the app cannot read sign-in state.",
  "- device-owner: the device table is missing, cannot be read, or a live row belongs to another client.",
  "- recent-delivery-failure: APNs rejected a send to a live device in the last two hours, or its receipt count could not be read.",
  "- native-open-receipts: a saved app open is missing or wrong on the Sales card, or either read failed.",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs native-push to see the first failed step.",
  "- Check both push routes, saved client choices, the live environment names, and device rows without printing keys or tokens.",
  "- After the route is healthy, send one approved test to an opted-in real iPhone and check that it arrives.",
  "Files: api/push/native-device.mjs, api/push/preferences.mjs, src/push/native-send.mjs, src/push/native-store.mjs, src/pulse/beats/beat-native-push.mjs, netlify/functions/api.mjs"
].join("\n");

function goodAnswers() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const encoded = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64");
  return {
    env: {
      NETLIFY: "true", APNS_KEY_ID: "A1B2C3D4E5", APNS_TEAM_ID: "F6G7H8I9J0",
      APNS_PRIVATE_KEY_BASE64: encoded, PUSH_SUB_ENC_KEY: Buffer.alloc(32, 1).toString("base64")
    },
    http: {
      [`GET ${SITE}${PREFERENCE_PATH}`]: { status: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) },
      [`GET ${SITE}${PATH}`]: { status: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) }
    },
    read: [
      { match: /FROM clients/, rows: [{ invalid_preferences: 0 }] },
      { match: /FROM client_apns_devices/, rows: [{ active: 1, wrong_owner: 0, recent_failed: 0 }] },
      { match: /SELECT id FROM orgs WHERE is_default/, rows: [{ id: "00000000-0000-4000-8000-000000000001" }] },
      { match: /SELECT demo_mode_enabled FROM orgs/, rows: [{ demo_mode_enabled: false }] },
      { match: /FROM cards cd/, rows: [{ client_id: "c1000000-0000-4000-8000-000000000001", app_first_authenticated_at: "2026-10-30T00:00:00Z" }] },
      { match: /FROM native_client_app_opens/, rows: [{ client_id: "c1000000-0000-4000-8000-000000000001", first_authenticated_at: "2026-10-30T00:00:00Z" }] }
    ]
  };
}

export const selfTest = {
  pass: () => goodAnswers(),
  fail: () => ({ ...goodAnswers(), read: [
    { match: /FROM clients/, rows: [{ invalid_preferences: 0 }] },
    { match: /FROM client_apns_devices/, rows: [{ active: 1, wrong_owner: 1, recent_failed: 0 }] }
  ] })
};
