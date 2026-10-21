// Bank outreach saved results. Read-only; no outreach or lender writes.
export const CHECK_IDS = Object.freeze([
  "bank-outreach:verified-product",
  "bank-outreach:next-action",
  "bank-outreach:email-safety",
  "bank-outreach:reply-waiting"
]);

// A verification is useful only while its promoted lender, source facts, evidence,
// and reachable banker still agree. Count defects without exposing contact data.
export const VERIFIED_SQL = `/* gap-bank-outreach:verified-product */
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE
         l.id IS NULL OR l.org_id IS DISTINCT FROM p.org_id
         OR l.active IS DISTINCT FROM true
         OR l.lender_table IS DISTINCT FROM p.lender_table
         OR l.product_name IS DISTINCT FROM p.product_name
         OR l.name IS DISTINCT FROM a.name
         OR l.application_url IS DISTINCT FROM CASE
              WHEN p.facts->>'application_url' ~* '^https?://[^ ]+' THEN p.facts->>'application_url'
              ELSE p.facts->>'paper_application_url' END
         OR l.eligible_states IS DISTINCT FROM expected.eligible_states
         OR l.bureaus_pulled IS DISTINCT FROM expected.bureaus_pulled
         OR l.minimum_time_in_business_years IS DISTINCT FROM expected.years
         OR l.minimum_revenue_threshold IS DISTINCT FROM expected.revenue
         OR l.stated_requirements IS DISTINCT FROM expected.requirements
         OR l.notes IS DISTINCT FROM expected.notes
         OR nullif(btrim(p.evidence), '') IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM outreach_contacts c
            WHERE c.org_id = p.org_id AND c.account_id = a.id
              AND nullif(btrim(c.name), '') IS NOT NULL
              AND (nullif(btrim(c.linkedin_url), '') IS NOT NULL
                OR nullif(btrim(c.email), '') IS NOT NULL
                OR nullif(btrim(c.phone), '') IS NOT NULL)
         )
         OR NOT (p.facts ?& ARRAY[
           'minimum_score','minimum_time_in_business_years','minimum_revenue_threshold',
           'bureaus_pulled','inquiry_tolerance','stated_income','eligible_states',
           'application_url','paper_application_url'])
         OR EXISTS (
           SELECT 1 FROM jsonb_each_text(p.facts) f
            WHERE f.key = ANY(ARRAY[
              'minimum_score','minimum_time_in_business_years','minimum_revenue_threshold',
              'bureaus_pulled','inquiry_tolerance','stated_income','eligible_states',
              'application_url','paper_application_url'])
              AND nullif(btrim(f.value), '') IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_each(p.facts) f
            WHERE f.key = ANY(ARRAY[
              'minimum_score','minimum_time_in_business_years','minimum_revenue_threshold',
              'bureaus_pulled','inquiry_tolerance','stated_income','eligible_states',
              'application_url','paper_application_url'])
              AND NOT (CASE
                WHEN f.key = 'minimum_score' THEN CASE WHEN jsonb_typeof(f.value) = 'number'
                  THEN (f.value #>> '{}')::numeric BETWEEN 300 AND 850 ELSE f.value = '"unknown"'::jsonb END
                WHEN f.key IN ('minimum_time_in_business_years','minimum_revenue_threshold')
                  THEN CASE WHEN jsonb_typeof(f.value) = 'number'
                    THEN (f.value #>> '{}')::numeric >= 0 ELSE f.value = '"unknown"'::jsonb END
                WHEN f.key = 'stated_income' THEN jsonb_typeof(f.value) = 'boolean' OR f.value = '"unknown"'::jsonb
                WHEN f.key IN ('bureaus_pulled','eligible_states') THEN CASE
                  WHEN jsonb_typeof(f.value) = 'array' THEN jsonb_array_length(f.value) > 0
                  ELSE f.value = '"unknown"'::jsonb END
                WHEN f.key IN ('application_url','paper_application_url') THEN
                  f.value = '"unknown"'::jsonb OR (jsonb_typeof(f.value) = 'string' AND (f.value #>> '{}') ~* '^https?://[^ ]+')
                ELSE jsonb_typeof(f.value) = 'string' AND nullif(btrim(f.value #>> '{}'), '') IS NOT NULL
              END)
         )
         OR NOT (
           p.facts->>'application_url' ~* '^https?://[^ ]+'
           OR p.facts->>'paper_application_url' ~* '^https?://[^ ]+'
         )
       )::int AS broken
  FROM outreach_products p
  JOIN outreach_accounts a ON a.id = p.account_id AND a.org_id = p.org_id
  JOIN outreach_programs program ON program.id = a.program_id AND program.org_id = a.org_id
  LEFT JOIN lenders l ON l.id = p.lender_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(p.facts->'eligible_states') = 'array'
             THEN array_to_string(ARRAY(SELECT item.value FROM jsonb_array_elements_text(p.facts->'eligible_states') WITH ORDINALITY AS item(value, ord) ORDER BY item.ord), ', ')
             ELSE NULL END AS eligible_states,
           CASE WHEN jsonb_typeof(p.facts->'bureaus_pulled') = 'array'
             THEN array_to_string(ARRAY(SELECT item.value FROM jsonb_array_elements_text(p.facts->'bureaus_pulled') WITH ORDINALITY AS item(value, ord) ORDER BY item.ord), '/')
             ELSE NULL END AS bureaus_pulled,
           CASE WHEN jsonb_typeof(p.facts->'minimum_time_in_business_years') = 'number'
             THEN (p.facts->>'minimum_time_in_business_years')::numeric ELSE NULL END AS years,
           CASE WHEN jsonb_typeof(p.facts->'minimum_revenue_threshold') = 'number'
             THEN (p.facts->>'minimum_revenue_threshold')::numeric ELSE NULL END AS revenue,
           concat('Minimum credit score ',
             CASE WHEN jsonb_typeof(p.facts->'minimum_score') = 'number'
               THEN p.facts->>'minimum_score' ELSE 'unknown' END,
             '. Inquiry tolerance: ', coalesce(p.facts->>'inquiry_tolerance', 'unknown'),
             '. Stated income: ',
             CASE WHEN jsonb_typeof(p.facts->'stated_income') = 'boolean'
               THEN CASE WHEN p.facts->>'stated_income' = 'true' THEN 'yes' ELSE 'no' END
               ELSE 'unknown' END, '.') AS requirements,
           concat(p.evidence, chr(10), 'Paper application: ',
             CASE WHEN p.facts->>'paper_application_url' ~* '^https?://[^ ]+'
               THEN p.facts->>'paper_application_url' ELSE 'unknown' END) AS notes
  ) expected ON true
 WHERE program.key = 'bank_relationships' AND p.verified_at IS NOT NULL`;

export const NEXT_ACTION_SQL = `/* gap-bank-outreach:next-action */
SELECT count(*)::int AS active,
       count(*) FILTER (WHERE nullif(btrim(a.next_action), '') IS NULL OR a.next_due_at IS NULL)::int AS missing
  FROM outreach_accounts a
  JOIN outreach_programs program ON program.id = a.program_id AND program.org_id = a.org_id
 WHERE program.key = 'bank_relationships'
   AND a.status IN ('researching','contacted','engaged','product_pending','verified_partner')`;

// Automatic bank email (495) that left the building in the last 30 days: every
// one must go to a saved banker, never after they said stop, and a cold step
// never after they wrote back. A real banker would feel each of these.
export const EMAIL_SAFETY_SQL = `/* gap-bank-outreach:email-safety */
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE c.id IS NULL OR lower(btrim(c.email)) IS DISTINCT FROM lower(btrim(m.to_address)))::int AS unknown_recipient,
       count(*) FILTER (WHERE c.email_opt_out_at IS NOT NULL AND c.email_opt_out_at < m.created_at)::int AS after_opt_out,
       count(*) FILTER (WHERE m.provider_ref ~ ':step[1-3]$' AND EXISTS (
         SELECT 1 FROM outreach_inbound_emails r
          WHERE r.org_id = m.org_id AND r.contact_id = c.id AND r.received_at < m.created_at
            AND COALESCE(r.kind, 'other') <> 'auto_reply'))::int AS after_reply
  FROM messages m
  LEFT JOIN outreach_contacts c ON c.org_id = m.org_id AND c.id::text = split_part(m.provider_ref, ':', 2)
 WHERE m.template_key LIKE 'EMAIL-BANK-OUTREACH-%' AND m.direction = 'outbound'
   AND m.status NOT IN ('queued', 'sending', 'blocked', 'failed')
   AND m.created_at > now() - interval '30 days'`;

// A banker reply the machine has not read within an hour is a stuck reader.
// Replies waiting for a person are work due, not a broken machine.
export const REPLY_WAITING_SQL = `/* gap-bank-outreach:reply-waiting */
SELECT count(*)::int AS waiting,
       count(*) FILTER (WHERE received_at < now() - interval '1 hour')::int AS stuck
  FROM outreach_inbound_emails WHERE status = 'new'`;

const row = (id, status, detail, suggestedFix = null) => ({ id, status, detail, suggestedFix });
const count = (value) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);

export function judgeVerified(result) {
  const total = count(result?.total);
  const broken = count(result?.broken);
  if (total === null || broken === null) return row(CHECK_IDS[0], "skip", "Verified lender result counts were not returned.");
  if (broken > 0) return row(CHECK_IDS[0], "FAIL", `${broken} of ${total} verified bank products lost their lender link, source evidence, banker contact, application path, or saved facts.`, "Review the verified product and promoted lender together. Repair the source record or promotion; do not mark an unverified product as verified.");
  return row(CHECK_IDS[0], "PASS", `${total} verified bank products have linked lender records, source evidence, reachable contacts, application paths, and saved facts.`);
}

export function judgeNextAction(result) {
  const active = count(result?.active);
  const missing = count(result?.missing);
  if (active === null || missing === null) return row(CHECK_IDS[1], "skip", "Bank outreach next-action counts were not returned.");
  if (missing > 0) return row(CHECK_IDS[1], "FAIL", `${missing} of ${active} active bank accounts have no saved next action or due time.`, "Open the bank outreach queue and give each active account a real next action and due time.");
  return row(CHECK_IDS[1], "PASS", `${active} active bank accounts have a saved next action and due time.`);
}

export function judgeEmailSafety(result) {
  const total = count(result?.total);
  const parts = ["unknown_recipient", "after_opt_out", "after_reply"].map((k) => count(result?.[k]));
  if (total === null || parts.some((v) => v === null)) return row(CHECK_IDS[2], "skip", "Bank outreach email counts were not returned.");
  const [unknown, afterOptOut, afterReply] = parts;
  if (unknown + afterOptOut + afterReply > 0) {
    return row(CHECK_IDS[2], "FAIL", `${total} bank outreach emails sent in 30 days: ${unknown} not to a saved banker, ${afterOptOut} after the banker said stop, ${afterReply} cold emails after the banker replied.`, "Stop the bank outreach job, read src/outreach/automation.mjs stopReasonFor and the gate's banker branch in src/messaging/gate.mjs, then fix the cause. Do not resend.");
  }
  return row(CHECK_IDS[2], "PASS", `${total} bank outreach emails sent in 30 days, all to saved bankers who had not said stop or replied.`);
}

export function judgeReplyWaiting(result) {
  const waiting = count(result?.waiting);
  const stuck = count(result?.stuck);
  if (waiting === null || stuck === null) return row(CHECK_IDS[3], "skip", "Banker reply counts were not returned.");
  if (stuck > 0) return row(CHECK_IDS[3], "FAIL", `${stuck} banker replies have waited over an hour for the reply reader.`, "Check the bank-outreach-automation job's read-replies step and its saved error on outreach_inbound_emails.");
  return row(CHECK_IDS[3], "PASS", `${waiting} banker replies are waiting to be read; none for over an hour.`);
}

export async function gapChecks({ db } = {}) {
  if (!db?.query) return CHECK_IDS.map((id) => row(id, "skip", "No database was available for bank outreach checks."));
  const checks = [
    [VERIFIED_SQL, judgeVerified, CHECK_IDS[0]],
    [NEXT_ACTION_SQL, judgeNextAction, CHECK_IDS[1]],
    [EMAIL_SAFETY_SQL, judgeEmailSafety, CHECK_IDS[2]],
    [REPLY_WAITING_SQL, judgeReplyWaiting, CHECK_IDS[3]]
  ];
  return Promise.all(checks.map(async ([sql, judge, id]) => {
    try { return judge((await db.query(sql)).rows?.[0]); }
    catch (error) { return row(id, "skip", `Bank outreach data could not be read: ${String(error?.message || error).slice(0, 120)}`); }
  }));
}
