// Read-only hourly adapter for Blueprint advisor, monthly and coach-call delivery.
// SQL is pinned byte-for-byte to gap-blueprint.mjs by this beat's test.
export const id = "blueprint-delivery";
export const title = "Blueprint clients have real advisors and completed delivery";
export const kind = "infra";
export const covers = ["desk:csm-queue.html", "job:finance-os-pull-sweeper", "job:waypoint-nudge-sweeper"];
export const box = false;
export const reads = [];
export const steps = ["real-advisor", "monthly-delivery", "coach-call-delivery"];
export const deadlineMs = 9000;
export const damp = 1;
export const CHECK_IDS = ["blueprint:real-advisor", "blueprint:monthly-delivery", "blueprint:coach-call-delivery"];
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

export const fixGuide = `A Blueprint client lacks a real advisor, monthly delivery or a complete coach-call receipt.

Likely causes:
- No real active non-demo advisor was available for the paid client.
- The credit result arrived, but a checklist, plan or letter step failed afterward.
- A coach call has an unresolved claim, missing attribution or an advisor exception.
Steps:
- Run node scripts/pulse/run-beat.mjs blueprint-delivery and read the first red step.
- Open blueprint-csm-assignment owner work and assign a real eligible human through the staff flow.
- Open blueprint-monthly-delivery owner work and finish delivery from its saved credit result.
- Open blueprint-coach-call advisor work; reconcile saved Bland receipts without redialing an uncertain result.
- Do not request another paid credit pull or send to clients from this check.
Files: src/blueprint/assign-csm.mjs, src/finance/finance-os-pull-fulfil.mjs, src/pulse/coverage/gap-blueprint.mjs
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
      "active paid Blueprint clients lack a real assigned advisor");
  });
  await ctx.step("monthly-delivery", () => countCheck(ctx, "monthly-delivery", MONTHLY_DELIVERY_SQL,
    [orgId, "blueprint-monthly-delivery", TEST_CLIENT_EMAIL_RE],
    "Blueprint monthly-delivery exceptions remain open; use the saved credit result"));
  await ctx.step("coach-call-delivery", () => countCheck(ctx, "coach-call-delivery", COACH_CALL_DELIVERY_SQL,
    [orgId, ctx.now.toISOString(), TEST_CLIENT_EMAIL_RE],
    "Blueprint coach-call delivery exceptions or unresolved receipts remain"));
  return ctx.done("No missing real advisor or open delivery exception was found. Counts do not prove a live customer delivery.");
}

const world = () => ({ read: [
  { match: /FROM orgs/, rows: [{ id: "00000000-0000-4000-8000-000000000001" }] },
  { match: /gap:blueprint-real-advisor/, rows: [{ n: 0 }] },
  { match: /gap:blueprint-monthly-delivery/, rows: [{ n: 0 }] },
  { match: /gap:blueprint-coach-call-delivery/, rows: [{ n: 0 }] }
] });
export const selfTest = { pass: world, fail: () => ({ read: [
  world().read[0], { match: /gap:blueprint-real-advisor/, rows: [{ n: 1 }] }
] }) };
