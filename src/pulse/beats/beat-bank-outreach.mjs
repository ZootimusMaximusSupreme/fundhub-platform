// An hourly read of the bank outreach door and promoted product integrity.
// Late human follow-ups live in the daily queue, not an hourly outage text.
export const id = "bank-outreach";
export const title = "Verified bank products stay usable";
export const kind = "probe";
export const covers = ["desk:bank-outreach.html", "route:bank-outreach", "route:read/bank-outreach", "job:bank-outreach-checkins"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const steps = ["read-door", "verified-result"];
export const checkIds = ["bank-outreach:verified-product"];
export const damp = 2;
export const deadlineMs = 5000;

export const VERIFIED_SQL = `/* beat-bank-outreach:verified-result */
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

export async function run(ctx) {
  await ctx.step("read-door", async () => {
    const res = await ctx.http.get(`${ctx.siteUrl}/api/read/bank-outreach`);
    if (![401, 403].includes(res.status)) {
      throw ctx.fail("read-door", `The bank outreach read door did not require staff sign-in (status ${res.status || 0}).`);
    }
  });
  await ctx.step("verified-result", async () => {
    let data;
    try { data = (await ctx.read(VERIFIED_SQL)).rows?.[0]; }
    catch (error) { throw ctx.fail("verified-result", `Verified bank product data could not be read: ${String(error?.message || error).slice(0, 100)}`); }
    const total = data?.total == null ? NaN : Number(data.total);
    const broken = data?.broken == null ? NaN : Number(data.broken);
    if (!Number.isFinite(total) || !Number.isFinite(broken)) throw ctx.fail("verified-result", "Verified bank product counts were not returned.");
    if (broken > 0) throw ctx.fail("verified-result", `${broken} of ${total} verified bank products lack a sound lender, evidence, banker, application path, or facts.`);
  });
  return ctx.done("Bank outreach read door is protected and verified bank product records are sound.");
}

export const fixGuide = [
  "A verified bank product or the bank outreach read door needs repair.",
  "",
  "Likely causes:",
  "- A lender row was changed or removed after product verification, breaking the saved result.",
  "- The bank outreach read route is missing or no longer requires staff sign-in.",
  "- Source evidence, a reachable banker, facts, or an application path disappeared.",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs bank-outreach and read the failed step.",
  "- Compare the verified outreach product with its linked lender and banker contact in the same org.",
  "- Repair the missing source or route, then rerun the beat. Do not promote a product without evidence.",
  "Files: src/pulse/coverage/gap-bank-outreach.mjs, src/outreach/store.mjs, netlify/functions/api.mjs"
].join("\n");

const healthy = () => ({
  http: { "GET https://fundhub.ai/api/read/bank-outreach": { status: 401, body: '{"ok":false}' } },
  read: [{ match: /beat-bank-outreach:verified-result/, rows: [{ total: 2, broken: 0 }] }]
});
export const selfTest = {
  pass: healthy,
  fail: () => ({ ...healthy(), read: [{ match: /beat-bank-outreach:verified-result/, rows: [{ total: 2, broken: 1 }] }] })
};
