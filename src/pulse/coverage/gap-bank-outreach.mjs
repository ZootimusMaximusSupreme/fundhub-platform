// Bank outreach saved results. Read-only; no outreach or lender writes.
export const CHECK_IDS = Object.freeze([
  "bank-outreach:verified-product",
  "bank-outreach:next-action"
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
             THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(p.facts->'eligible_states')), ', ')
             ELSE NULL END AS eligible_states,
           CASE WHEN jsonb_typeof(p.facts->'bureaus_pulled') = 'array'
             THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(p.facts->'bureaus_pulled')), '/')
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
               ELSE 'unknown' END, '.') AS requirements
  ) expected ON true
 WHERE program.key = 'bank_relationships' AND p.verified_at IS NOT NULL`;

export const NEXT_ACTION_SQL = `/* gap-bank-outreach:next-action */
SELECT count(*)::int AS active,
       count(*) FILTER (WHERE nullif(btrim(a.next_action), '') IS NULL OR a.next_due_at IS NULL)::int AS missing
  FROM outreach_accounts a
  JOIN outreach_programs program ON program.id = a.program_id AND program.org_id = a.org_id
 WHERE program.key = 'bank_relationships'
   AND a.status IN ('researching','contacted','engaged','product_pending','verified_partner')`;

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

export async function gapChecks({ db } = {}) {
  if (!db?.query) return CHECK_IDS.map((id) => row(id, "skip", "No database was available for bank outreach checks."));
  const checks = [
    [VERIFIED_SQL, judgeVerified, CHECK_IDS[0]],
    [NEXT_ACTION_SQL, judgeNextAction, CHECK_IDS[1]]
  ];
  return Promise.all(checks.map(async ([sql, judge, id]) => {
    try { return judge((await db.query(sql)).rows?.[0]); }
    catch (error) { return row(id, "skip", `Bank outreach data could not be read: ${String(error?.message || error).slice(0, 120)}`); }
  }));
}
