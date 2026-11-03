// Read-only hourly adapter for Blueprint staff-link, monthly and coach-call delivery.
// SQL is pinned byte-for-byte to gap-blueprint.mjs by this beat's test.
// Owner-set 2026-10-20: no staff CSM on a paid buyer is normal (the AI coaches
// plus the team CSM queue are the CSM). Only a broken saved staff link is red.
export const id = "blueprint-delivery";
export const title = "Blueprint staff links and delivery are sound";
export const kind = "infra";
export const covers = ["desk:csm-queue.html", "job:finance-os-pull-sweeper", "job:waypoint-nudge-sweeper", "route:blueprint/plan", "route:blueprint/business-plans"];
export const box = false;
export const reads = [];
export const steps = ["real-advisor", "monthly-delivery", "coach-call-delivery", "preparation-evidence"];
export const deadlineMs = 9000;
export const damp = 1;
export const CHECK_IDS = ["blueprint:real-advisor", "blueprint:monthly-delivery", "blueprint:coach-call-delivery", "blueprint:preparation-evidence"];
export const ORG_SQL = "SELECT id FROM orgs WHERE slug = 'fundhub'";
export const TEST_CLIENT_EMAIL_RE = String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$`;

const REAL_CLIENT = `COALESCE(c.is_demo, false) = false
  AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
  AND COALESCE(c.email, '') !~* $3::text`;

export const REAL_ADVISOR_SQL = `
  /* gap:blueprint-real-advisor */
  SELECT count(*)::int AS n
    FROM clients c
   WHERE c.org_id = $1::uuid
     AND ${REAL_CLIENT}
     AND EXISTS (
       SELECT 1 FROM transactions t
       JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
         AND p.org_id = t.org_id
       WHERE t.org_id = c.org_id AND t.client_id = c.id
         AND lower(p.code) = lower($4::text)
         AND lower(btrim(COALESCE(t.status, ''))) = $5::text
         AND COALESCE(t.is_demo, false) = false
     )
     AND EXISTS (
       SELECT 1 FROM subscriptions s
       WHERE s.org_id = c.org_id AND s.client_id = c.id
         AND s.tier = 'finance-os' AND s.status = 'active'
         AND s.effective_from <= $2::timestamptz
         AND (s.effective_to IS NULL OR s.effective_to > $2::timestamptz)
         AND (s.current_period_start IS NULL OR s.current_period_start <= $2::timestamptz)
         AND (s.current_period_end IS NULL OR s.current_period_end > $2::timestamptz)
     )
     AND c.assigned_csm_staff_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM staff s
       WHERE s.org_id = c.org_id AND s.id = c.assigned_csm_staff_id
         AND lower(btrim(COALESCE(s.role, ''))) = 'csm'
         AND s.status = 'active' AND s.active = true AND s.is_demo = false
     )
`;

export const MONTHLY_DELIVERY_SQL = `
  /* gap:blueprint-monthly-delivery */
  SELECT count(*)::int AS n
    FROM tasks t
    JOIN clients c ON c.org_id = t.org_id AND c.id = t.client_id
   WHERE t.org_id = $1::uuid
     AND t.source_workflow = $2::text
     AND t.done = false AND COALESCE(t.is_demo, false) = false
     AND ${REAL_CLIENT}
`;

export const COACH_CALL_DELIVERY_SQL = `
  /* gap:blueprint-coach-call-delivery */
  SELECT count(*)::int AS n FROM (
    SELECT n.id
      FROM waypoint_nudges n
      JOIN clients c ON c.org_id = n.org_id AND c.id = n.client_id
     WHERE n.org_id = $1::uuid AND n.step = 5 AND n.kind = 'voice_call'
       AND n.channel = 'voice' AND n.template_key = 'BP-COACH-VOICE'
       AND COALESCE(c.is_demo, false) = false
  AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
  AND COALESCE(c.email, '') !~* $3::text
       AND (
         (n.outcome = 'claimed' AND n.created_at < $2::timestamptz - interval '1 hour')
         OR (n.outcome = 'queued' AND NOT EXISTS (
           SELECT 1 FROM messages m
           JOIN outbound_calls oc ON oc.call_id = m.provider_message_id
             AND oc.org_id = m.org_id AND oc.client_id = m.client_id
           WHERE m.id = n.message_id AND m.org_id = n.org_id AND m.client_id = n.client_id
             AND m.channel = 'voice' AND m.direction = 'outbound'
             AND m.status = 'sent' AND m.provider = 'bland'
             AND m.provider_ref = n.idempotency_key
             AND m.provider_message_id IS NOT NULL AND btrim(m.provider_message_id) <> ''
         ))
       )
    UNION ALL
    SELECT t.id
      FROM tasks t
      JOIN clients c ON c.org_id = t.org_id AND c.id = t.client_id
     WHERE t.org_id = $1::uuid AND t.source_workflow = 'blueprint-coach-call'
       AND t.done = false AND COALESCE(t.is_demo, false) = false
       AND COALESCE(c.is_demo, false) = false
  AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
  AND COALESCE(c.email, '') !~* $3::text
  ) failures
`;

// Saved data integrity only; incomplete client work is not a delivery failure.
export const PREPARATION_EVIDENCE_SQL = `
  /* gap:blueprint-preparation-evidence */
  WITH scoped_clients AS (
    SELECT c.id, c.org_id, c.custom_fields->'blueprint_business_plans' AS state
      FROM clients c
     WHERE c.org_id = $1::uuid
       AND ${REAL_CLIENT}
       AND EXISTS (
         SELECT 1 FROM entitlements e
         JOIN transactions t ON t.id = e.source_transaction_id
           AND t.org_id = e.org_id AND t.client_id = e.client_id
         JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
           AND p.org_id = t.org_id
         WHERE e.org_id = c.org_id AND e.client_id = c.id
           AND e.entitlement_code = 'credit-optimization-roadmap' AND e.revoked_at IS NULL
           AND (e.expires_at IS NULL OR e.expires_at > $2::timestamptz)
           AND lower(btrim(p.code)) = lower($4::text)
           AND lower(btrim(COALESCE(t.status, ''))) = $5::text
           AND COALESCE(t.is_demo, false) = false
           AND t.created_at <= $2::timestamptz
           AND t.created_at + interval '12 months' > $2::timestamptz
       )
  ), saved AS (
    SELECT * FROM scoped_clients
     WHERE state IS NOT NULL AND state NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)
       AND NOT (jsonb_typeof(state) = 'object' AND NOT (state ? 'version')
         AND state - 'businesses' - 'stepProgress' = '{}'::jsonb
         AND COALESCE(state->'businesses', '[]'::jsonb) = '[]'::jsonb
         AND COALESCE(state->'stepProgress', '[]'::jsonb) = '[]'::jsonb)
  ), plans AS (
    SELECT s.id AS client_id, s.org_id, p.plan
      FROM saved s CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.state->'businesses') = 'array' THEN s.state->'businesses' ELSE '[]'::jsonb END
      ) AS p(plan)
  ), evidence AS (
    SELECT p.client_id, p.org_id, p.plan->>'id' AS plan_id, p.plan->>'entityId' AS entity_id,
      e.key AS evidence_kind, e.value->>'documentId' AS document_id
      FROM plans p CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(p.plan->'evidence') = 'object' THEN p.plan->'evidence' ELSE '{}'::jsonb END
      ) e
     WHERE e.key IN ('formation', 'ein') AND e.value->>'documentId' IS NOT NULL
  )
  SELECT count(*)::int AS n FROM saved s
   WHERE jsonb_typeof(s.state) IS DISTINCT FROM 'object'
      OR s.state->>'version' IS DISTINCT FROM '1'
      OR COALESCE(s.state->>'targetBusinessCount', '') NOT IN ('3', '4')
      OR CASE WHEN jsonb_typeof(s.state->'businesses') = 'array'
           THEN jsonb_array_length(s.state->'businesses') > 4 ELSE true END
      OR jsonb_typeof(s.state->'stepProgress') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM plans p WHERE p.client_id = s.id AND p.org_id = s.org_id
          AND (jsonb_typeof(p.plan) IS DISTINCT FROM 'object'
            OR COALESCE(p.plan->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            OR COALESCE(p.plan->>'formationStatus', '') NOT IN ('planned', 'reported_formed'))
      )
      OR EXISTS (
        SELECT 1 FROM evidence e WHERE e.client_id = s.id AND e.org_id = s.org_id
          AND (NOT EXISTS (
            SELECT 1 FROM documents d LEFT JOIN document_vault_reviews r
              ON r.document_id = d.id AND r.org_id = d.org_id AND r.client_id = d.client_id
             WHERE d.org_id = e.org_id AND d.client_id = e.client_id AND d.id::text = e.document_id
               AND d.kind = 'client_upload'
               AND d.subtype = CASE e.evidence_kind WHEN 'formation' THEN 'articles_of_organization' ELSE 'ein_letter' END
               AND (COALESCE(NULLIF(d.metadata->>'entity_id', ''), r.entity_id::text) IS NULL
                 OR COALESCE(NULLIF(d.metadata->>'entity_id', ''), r.entity_id::text) = e.entity_id)
          ) OR EXISTS (
            SELECT 1 FROM evidence other WHERE other.org_id = e.org_id AND other.client_id = e.client_id
              AND other.document_id = e.document_id AND other.plan_id IS DISTINCT FROM e.plan_id
          ))
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(s.state->'stepProgress') = 'array' THEN s.state->'stepProgress' ELSE '[]'::jsonb END
        ) AS progress(step)
        WHERE jsonb_typeof(step) IS DISTINCT FROM 'object'
          OR COALESCE(step->>'status', '') NOT IN ('not_started', 'in_progress', 'reported_complete', 'blocked')
          OR COALESCE(step->>'verification', 'client_reported') <> 'client_reported'
          OR (step->>'businessPlanId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM plans p WHERE p.org_id = s.org_id AND p.client_id = s.id
              AND p.plan->>'id' = step->>'businessPlanId'
          ))
      )
`;

export const fixGuide = `A Blueprint client has a broken staff link, unfinished monthly delivery or an incomplete coach-call receipt.

Likely causes:
- A paid client is linked to a demo, disabled, suspended or other-company staff person. (No staff link at all is normal: the AI coaches and team CSM queue are the CSM.)
- The credit result arrived, but a checklist, plan or letter step failed afterward.
- A coach call has an unresolved claim, missing attribution or an advisor exception.
Steps:
- Run node scripts/pulse/run-beat.mjs blueprint-delivery and read the first red step.
- Open blueprint-csm-assignment owner work and clear or fix the broken staff link through the staff flow.
- Open blueprint-monthly-delivery owner work and finish delivery from its saved credit result.
- Open blueprint-coach-call advisor work; reconcile saved Bland receipts without redialing an uncertain result.
- Do not request another paid credit pull or send to clients from this check.
Files: src/blueprint/assign-csm.mjs, src/finance/finance-os-pull-fulfil.mjs, src/pulse/coverage/gap-blueprint.mjs
Preparation evidence: repair a malformed saved plan or its missing/wrong-client document link through the authenticated Blueprint flow. Do not treat a reported step as reviewed proof.
`;

async function countCheck(ctx, step, sql, params, description) {
  let raw;
  try { raw = (await ctx.read(sql, params)).rows[0]?.n; }
  catch { throw ctx.fail(step, "Blueprint delivery state could not be read."); }
  const n = typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw ctx.fail(step, "Blueprint delivery count could not be read.");
  if (n > 0) throw ctx.fail(step, `${n} ${description}.`);
}

export async function run(ctx) {
  let orgId;
  await ctx.step("real-advisor", async () => {
    let rows;
    try { rows = (await ctx.read(ORG_SQL)).rows; }
    catch { throw ctx.fail("real-advisor", "The Fundhub company could not be read."); }
    orgId = rows?.length === 1 ? rows[0]?.id : null;
    if (typeof orgId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId)) {
      throw ctx.fail("real-advisor", "The Fundhub company could not be identified.");
    }
    await countCheck(ctx, "real-advisor", REAL_ADVISOR_SQL,
      [orgId, ctx.now.toISOString(), TEST_CLIENT_EMAIL_RE, "consulting-package", "succeeded"],
      "active paid Blueprint clients are linked to a demo, disabled or other-company staff person");
  });
  await ctx.step("monthly-delivery", () => countCheck(ctx, "monthly-delivery", MONTHLY_DELIVERY_SQL,
    [orgId, "blueprint-monthly-delivery", TEST_CLIENT_EMAIL_RE],
    "Blueprint monthly-delivery exceptions remain open; use the saved credit result"));
  await ctx.step("coach-call-delivery", () => countCheck(ctx, "coach-call-delivery", COACH_CALL_DELIVERY_SQL,
    [orgId, ctx.now.toISOString(), TEST_CLIENT_EMAIL_RE],
    "Blueprint coach-call delivery exceptions or unresolved receipts remain"));
  await ctx.step("preparation-evidence", () => countCheck(ctx, "preparation-evidence", PREPARATION_EVIDENCE_SQL,
    [orgId, ctx.now.toISOString(), TEST_CLIENT_EMAIL_RE, "consulting-package", "succeeded"],
    "active Blueprint clients have malformed preparation state or invalid linked evidence"));
  return ctx.done("No broken staff link or open delivery exception was found. Counts do not prove a live customer delivery.");
}

const world = () => ({ read: [
  { match: /FROM orgs/, rows: [{ id: "00000000-0000-4000-8000-000000000001" }] },
  { match: /gap:blueprint-real-advisor/, rows: [{ n: 0 }] },
  { match: /gap:blueprint-monthly-delivery/, rows: [{ n: 0 }] },
  { match: /gap:blueprint-coach-call-delivery/, rows: [{ n: 0 }] },
  { match: /gap:blueprint-preparation-evidence/, rows: [{ n: 0 }] }
] });
export const selfTest = { pass: world, fail: () => ({ read: [
  world().read[0], { match: /gap:blueprint-real-advisor/, rows: [{ n: 1 }] }
] }) };
