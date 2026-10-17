import { nativePushConfigured } from "../../push/native-store.mjs";

export const NATIVE_PUSH_OWNERS_SQL = `
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

export const MARKETING_PUSH_PREFERENCE_SQL = `
SELECT count(*)::int AS invalid_preferences
  FROM clients
 WHERE custom_fields ? 'marketing_push_enabled'
   AND jsonb_typeof(custom_fields -> 'marketing_push_enabled') <> 'boolean'
`.trim();

export async function gapChecks(ctx = {}) {
  const db = ctx.db;
  const ready = nativePushConfigured(ctx.env || process.env);
  const configured = { id: "native-push:configured", status: ready ? "PASS" : "FAIL",
    detail: ready ? "Native push signing and encrypted storage are configured."
      : "The APNs signing key, IDs, or device storage key is missing or unusable.",
    suggestedFix: ready ? null : "Enable Push Notifications for ai.fundhub.app, add the APNs key to Netlify, then deliver a test to a real iPhone." };
  if (!db) return [
    { id: "native-push:device-owner", status: "skip",
      detail: "No database read was available, so native device ownership was not checked." },
    { id: "native-push:recent-delivery-failure", status: "skip",
      detail: "No database read was available, so recent APNs failures were not checked." },
    { id: "marketing-push:preference-shape", status: "skip",
      detail: "No database read was available, so saved marketing push choices were not checked." },
    configured
  ];
  try {
    const result = await db.query(NATIVE_PUSH_OWNERS_SQL);
    const active = Number(result.rows[0]?.active);
    const wrong = Number(result.rows[0]?.wrong_owner);
    const recentFailed = result.rows[0]?.recent_failed == null ? NaN : Number(result.rows[0].recent_failed);
    let preference;
    try {
      const prefs = await db.query(MARKETING_PUSH_PREFERENCE_SQL);
      const invalid = prefs.rows[0]?.invalid_preferences == null ? NaN : Number(prefs.rows[0].invalid_preferences);
      preference = { id: "marketing-push:preference-shape", status: !Number.isFinite(invalid) ? "skip" : invalid ? "FAIL" : "PASS",
        detail: !Number.isFinite(invalid) ? "The saved preference count was not returned."
          : invalid ? `${invalid} client marketing push choices are not saved as a true or false value.`
            : "Saved client marketing push choices are boolean; missing choices stay off.",
        suggestedFix: invalid ? "Inspect malformed choices; do not turn marketing alerts on for them by guesswork." : null };
    } catch {
      preference = { id: "marketing-push:preference-shape", status: "skip",
        detail: "Could not read saved marketing push choices." };
    }
    return [
      { id: "native-push:device-owner", status: !Number.isFinite(wrong) ? "skip" : wrong ? "FAIL" : "PASS",
        detail: !Number.isFinite(wrong) ? "The native device ownership count was not returned."
          : wrong ? `${wrong} live iPhone devices are attached to the wrong or inactive client account.`
            : `${active} live iPhone devices are attached to active client accounts.`,
        suggestedFix: wrong ? "Revoke the mismatched device rows; do not send to them." : null },
      { id: "native-push:recent-delivery-failure", status: !Number.isFinite(recentFailed) ? "skip" : recentFailed ? "FAIL" : "PASS",
        detail: !Number.isFinite(recentFailed) ? "The recent APNs failure count was not returned."
          : recentFailed ? `${recentFailed} active iPhone devices reported an APNs send failure in the last two hours.`
            : "No recent APNs failure is recorded. This does not prove a booking alert reached an iPhone.",
        suggestedFix: recentFailed ? "Check APNs rejection and the affected device without exposing its token." : null },
      preference,
      configured
    ];
  } catch (error) {
    const detail = `Could not read native push devices: ${String(error?.message || error).slice(0, 120)}`;
    return [
      { id: "native-push:device-owner", status: "skip", detail },
      { id: "native-push:recent-delivery-failure", status: "skip", detail },
      { id: "marketing-push:preference-shape", status: "skip", detail },
      configured
    ];
  }
}
