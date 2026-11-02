// GET /api/dashboard/clients
// Read-only closer dashboard — list of clients with aggregated journey state.
// Returns most-recent-first; default limit 50, override via ?limit=N.
// No writes. SELECT only. ESM. Mirrors api/health.mjs style.
import { db } from "../../src/db.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { boundedLimit, requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { orgDemoModeEnabled } from "../../src/demo/exclude-demo.mjs";
import { deriveNextAction } from "../../src/fulfillment/next-action.mjs";
import {
  gatherListSignals,
  signalsForListRow,
  listRollups
} from "../../src/fulfillment/read-signals.mjs";

const SQL = `
  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.email,
    c.outcome_tier,
    c.funded,
    c.funded_amount,
    c.is_demo,
    /* The RAW blob and the RAW tag array, lifted for the fulfillment
       derivation. NEITHER IS ADDED TO THE RESPONSE — the mapper below still
       builds exactly the custom_fields object it always has. They are lifted
       because that mapper coerces a missing crs_paid to false (Phase 0 defect
       7), which turns "we do not know" into "no", and the derivation has to see
       the blank as a blank. Both are plain columns on clients, which is grouped
       by its primary key, so no join and no aggregate changes. */
    c.custom_fields                                   AS custom_fields_raw,
    c.tags                                            AS tags_raw,
    -- custom_fields flags
    (c.custom_fields->>'crs_paid')::boolean          AS crs_paid,
    (c.custom_fields->>'deposit_paid')::boolean       AS deposit_paid,
    (c.custom_fields->>'sale_closed')::boolean        AS sale_closed,
    (c.custom_fields->>'total_funding_estimate')      AS total_funding_estimate,
    c.created_at,
    -- transactions aggregate
    COUNT(DISTINCT t.id)                              AS tx_count,
    (ARRAY_AGG(t.product_name ORDER BY t.created_at DESC))[1] AS tx_latest_product,
    (ARRAY_AGG(t.amount_paid  ORDER BY t.created_at DESC))[1] AS tx_latest_amount,
    (ARRAY_AGG(t.status       ORDER BY t.created_at DESC))[1] AS tx_latest_status,
    -- crs_results count
    COUNT(DISTINCT cr.id)                             AS crs_count,
    -- tasks count
    COUNT(DISTINCT tk.id)                             AS task_count,
    -- latest message
    (ARRAY_AGG(m.channel   ORDER BY m.created_at DESC))[1] AS last_msg_channel,
    (ARRAY_AGG(m.direction ORDER BY m.created_at DESC))[1] AS last_msg_direction,
    (ARRAY_AGG(m.created_at ORDER BY m.created_at DESC))[1] AS last_msg_at
  FROM clients c
  LEFT JOIN transactions t   ON t.client_id = c.id AND t.org_id = c.org_id
  LEFT JOIN crs_results  cr  ON cr.client_id = c.id AND cr.org_id = c.org_id
  LEFT JOIN tasks        tk  ON tk.client_id = c.id AND tk.org_id = c.org_id
  LEFT JOIN messages     m   ON m.client_id  = c.id AND m.org_id = c.org_id
  WHERE c.org_id = $1
    AND ($3::boolean OR COALESCE(c.is_demo, false) = false)
    AND c.custom_fields->>'crm_archived_at' IS NULL
  GROUP BY c.id
  ORDER BY c.created_at DESC
  LIMIT $2
`;

/* Did the caller ask for the fulfillment derivation? Opt-in, and OFF by
   default: absent, blank or anything unrecognised means no. Same words
   api/finance/cards.mjs:152 already uses for a boolean query flag, so the two
   read the same. A missing `req.query` is a caller that asked for nothing. */
function wantsFulfillment(query) {
  const raw = String((query && query.fulfillment) ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export default async function handler(req, res) {
  // Staff session first; the DASHBOARD_SECRET gate stays as the fallback until
  // cutover, so existing links keep working while staff accounts roll out.
  // GET only. These answered POST/PUT/DELETE/PATCH with 200 and the full
  // client book, so any method reached read data that only GET should serve.
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  /* "Signed in" was the whole gate, and every staff row is signed in — including
     role='partner', which is an EXTERNAL white-label operator. That handed the
     entire client book (names, emails, funded amounts) to a party outside the
     company. ROLE_SETS.STAFF already excludes 'partner' and denies unknown roles
     by default; this endpoint simply never called it.
     `true` is the DASHBOARD_SECRET fallback caller, which has no role to check. */
  if (staff !== true && !requireRole(res, staff, ROLE_SETS.STAFF)) return;
  // Org from the session ONLY. Shared-secret callers have no org — refuse rather
  // than dump every company's client book. Confirmed class of the P0 client leak.
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;
  try {
    const limit = boundedLimit(req.query?.limit, { fallback: 50, cap: 500 });
    const demoOn = await orgDemoModeEnabled(db, orgId);
    const { rows } = await db.query(SQL, [orgId, limit, demoOn]);
    const clients = rows.map((r) => ({
      id:           r.id,
      first_name:   r.first_name,
      last_name:    r.last_name,
      email:        r.email,
      outcome_tier: r.outcome_tier,
      funded:       r.funded,
      funded_amount: r.funded_amount,
      is_demo: !!r.is_demo,
      custom_fields: {
        crs_paid:               r.crs_paid ?? false,
        deposit_paid:           r.deposit_paid ?? false,
        sale_closed:            r.sale_closed ?? false,
        total_funding_estimate: r.total_funding_estimate ?? null,
      },
      transactions: {
        count:          Number(r.tx_count),
        latest_product: r.tx_latest_product ?? null,
        latest_amount:  r.tx_latest_amount  ?? null,
        latest_status:  r.tx_latest_status  ?? null,
      },
      crs_count:  Number(r.crs_count),
      task_count: Number(r.task_count),
      last_message: {
        channel:   r.last_msg_channel   ?? null,
        direction: r.last_msg_direction ?? null,
        at:        r.last_msg_at        ?? null,
      },
      created_at: r.created_at,
    }));

    /* FULFILLMENT — the next-action chip per client, plus the six tiles.
       READ ONLY, and OPT-IN.

       OPT-IN, BECAUSE MOST CALLERS DO NOT WANT IT. This block costs ELEVEN
       extra reads — ten signal reads plus the tile count. They are constant,
       not per client, so there is no N+1 here; but this endpoint is also the
       client picker on the Client Control Panel, which uses none of them. So
       it runs only when the caller asks for it with `?fulfillment=1`. Without
       that parameter this handler makes exactly the three reads it made before
       this work existed and answers exactly the body it answered before —
       every new key absent, `rollups` absent. Only the pipeline page's
       Fulfillment lens asks (public/app/data.js, FHData.clients).

       ONE PASS, NEVER A LOOP. gatherListSignals() answers for the entire page
       in one round of parallel statements keyed on `client_id = ANY(...)`.
       Nothing here queries per client.

       ALL OR NOTHING. The whole block is wrapped, and the answers are
       ASSEMBLED IN FULL BEFORE ANY OF THEM IS ATTACHED. deriveNextAction()
       never throws, but signalsForListRow() reads the client row, so a row
       that refuses part-way through the page would otherwise leave the clients
       before it carrying the new keys and the clients after it without them.
       A half-answered list is worse than an unanswered one — a screen cannot
       tell "no action" from "we never got there". Assemble, then attach, so a
       failure anywhere leaves `clients` exactly as it was mapped above, leaves
       every new key ABSENT and leaves the tiles out too.

       NOT REUSED, ON PURPOSE: `crs_count` above has no is_demo filter (Phase 0)
       and the mapped `custom_fields` turns unknown into false. The derivation
       reads a separately counted, demo-filtered credit total and the raw blob
       instead. Neither existing field is changed — both bugs are Chris's for a
       later batch. */
    let rollups = null;
    if (wantsFulfillment(req.query)) {
      try {
        const [signals, tiles] = await Promise.all([
          gatherListSignals(db, { orgId, clientIds: rows.map((r) => r.id) }),
          listRollups(db, { orgId, demoOn })
        ]);
        // Assemble first. Nothing below this line can fail part-way.
        const derived = rows.map(
          (r) => deriveNextAction(signalsForListRow(r, signals.get(String(r.id))))
        );
        derived.forEach((d, i) => {
          clients[i].next_action          = d.next_action;
          clients[i].active_blockers      = d.active_blockers;
          clients[i].funding_round        = d.funding_round;
          clients[i].next_action_degraded = d.degraded;
        });
        rollups = tiles;
      } catch (err) {
        console.warn("[fulfillment] next action unavailable for client list:", err && err.message);
        rollups = null;
      }
    }

    res.status(200).json({
      ok: true,
      count: clients.length,
      clients,
      ...(rollups ? { rollups } : {})
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
