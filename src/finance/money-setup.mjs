// Finance OS setup — where one client stands on the four setup steps.
//
// Owner direction (docs/finance/finance-os-direction-2026-10-06.md): a one-time
// setup fee, a soft pull for business credit (no hard inquiry), then a quick
// payment to activate. Price per container and the setup fee are both "not set"
// today, so both come back as null and the page paints "$X".
//
// THIS FILE READS. The two writes the setup page can cause live elsewhere and
// are reused, not rebuilt:
//   * the setup checkout is a payment_links row minted by
//     src/payment-links/index.mjs createPaymentLink (Commas checkout session).
//     No new Commas product is created — the title is an existing one.
//   * the soft pull goes through the signed approval form
//     (src/consent/approve-token.mjs → /app/soft-pull-approve.html). That form
//     captures consent and identity and mints the $32 checkout; the pull itself
//     only runs on diagnostic.paid (src/workflows/c-00-crs-soft-pull-request.mjs).
//     Nothing here asks a bureau for anything or charges anyone.
//
// MONEY IS INTEGER CENTS. Unknown is null, never 0 (CLAUDE.md §12).

import { readPricePerContainer, containerBilling } from "./containers.mjs";
import { financeOsEntitlement } from "./finance-os-entitlement.mjs";
import { SOFT_PULL_BUSINESS_ADDON_CENTS, softPullBaseCents } from "./soft-pull-pricing.mjs";

export const SETUP_FEE_ENV = "FINANCE_OS_SETUP_FEE_CENTS";

/* The payment_links row that IS the setup fee. purpose 'custom' (the table's
   check allows deposit / diagnostic / repair / custom and nothing else) and this
   exact description. The description is stored on our row only; it is never
   sent to Commas. */
export const SETUP_PURPOSE = "custom";
export const SETUP_DESCRIPTION = "Finance OS setup";

/* The Commas-facing title. AN EXISTING PRODUCT TITLE, NOT A NEW ONE — the rule
   for this unit is never to create a Commas catalog product. Not the default
   "Consulting Services Package": src/adapters/commas.mjs productOf() matches
   that title to the DIY letters bucket and would fire sale.closed on a setup
   payment. "Consulting Services Engagement" matches no legacy title needle, so a
   paid setup link emits payment.received and marks this row paid, nothing else.
   It passes src/payments/commas-safe-copy.mjs (no "fee", no "finance"). */
export const SETUP_COMMAS_TITLE = "Consulting Services Engagement";

const OPEN = ["created", "sent"];

/** readSetupFeeCents(env) → positive integer cents, or null when unset. */
export function readSetupFeeCents(env = {}) {
  const raw = env?.[SETUP_FEE_ENV];
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function iso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** The setup links on this client's file: the paid one (if any) and the newest open one. */
export async function readSetupLinks(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT id, status, amount_cents, checkout_url, paid_at, created_at
       FROM payment_links
      WHERE org_id = $1 AND client_id = $2
        AND purpose = $3 AND description = $4
      ORDER BY created_at DESC`,
    [orgId, clientId, SETUP_PURPOSE, SETUP_DESCRIPTION]
  );
  const rows = r.rows || [];
  const paid = rows.find((x) => x.status === "paid") || null;
  const open = rows.find((x) => OPEN.includes(x.status)) || null;
  return { paid, open };
}

/** Soft pull, from the two places a pull leaves a mark (same pair portal-summary reads). */
export async function readSoftPull(db, { orgId, clientId }) {
  const [reqs, results] = await Promise.all([
    db.query(
      `SELECT status, requested_at, resolved_at
         FROM soft_pull_requests
        WHERE org_id = $1 AND client_id = $2
          AND status IN ('queued', 'processing', 'fulfilled')
        ORDER BY requested_at DESC`,
      [orgId, clientId]
    ),
    db.query(
      `SELECT created_at
         FROM crs_results
        WHERE org_id = $1 AND client_id = $2
          AND is_demo IS NOT TRUE
        ORDER BY created_at DESC
        LIMIT 1`,
      [orgId, clientId]
    )
  ]);
  const reqRows = reqs.rows || [];
  const last = (results.rows || [])[0] || null;
  const fulfilled = reqRows.find((x) => x.status === "fulfilled") || null;
  const completed = !!last || !!fulfilled;
  return {
    requested: completed || reqRows.length > 0,
    completed,
    last_pulled_at: iso(last ? last.created_at : fulfilled ? fulfilled.resolved_at : null),
    price: { base_cents: softPullBaseCents(), business_addon_cents: SOFT_PULL_BUSINESS_ADDON_CENTS }
  };
}

/**
 * setupSteps — the four steps, in order. `current` is the first one not done.
 * Each step is done only on a fact read above; nothing is assumed.
 */
export function setupSteps({ paid, softPull, containers, entitled }) {
  const steps = [
    { key: "pay", label: "Pay setup fee", done: !!paid },
    { key: "soft_pull", label: "Run your soft pull", done: !!(softPull && softPull.completed) },
    { key: "accounts", label: "Add your businesses and accounts", done: Number(containers) > 0 },
    { key: "live", label: "You're live", done: !!entitled }
  ];
  const next = steps.find((s) => !s.done);
  return { steps, current: next ? next.key : null };
}

/**
 * readSetupStatus(db, { orgId, clientId, env, asOf }) → the GET /api/money/setup
 * payload, or null when the client is not in this org.
 */
export async function readSetupStatus(db, { orgId, clientId, env = {}, asOf = new Date() }) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!clientId) throw new TypeError("clientId is required");

  const who = await db.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = (who.rows || [])[0];
  if (!client) return null;

  const [links, softPull, billing, ent] = await Promise.all([
    readSetupLinks(db, { orgId, clientId }),
    readSoftPull(db, { orgId, clientId }),
    containerBilling(db, { orgId, clientId, env }),
    financeOsEntitlement(db, { orgId, clientId, asOf })
  ]);

  const paid = !!links.paid;
  const containers = Number(billing.containers) || 0;
  const { steps, current } = setupSteps({ paid, softPull, containers, entitled: ent.entitled });
  const name = [client.first_name, client.last_name].filter(Boolean).join(" ").trim();

  return {
    ok: true,
    client: { id: client.id, name: name || null },
    as_of: iso(asOf),
    paid,
    paid_at: iso(links.paid ? links.paid.paid_at : null),
    setup_fee_cents: readSetupFeeCents(env),
    price_per_container_cents: readPricePerContainer(env),
    containers,
    monthly_cents: billing.monthly_cents ?? null,
    /* An unpaid setup checkout already on file, so the page can say "finish
       paying" instead of minting a second one. The client's own link only. */
    open_checkout: links.open && !paid
      ? { url: links.open.checkout_url, amount_cents: Number(links.open.amount_cents) }
      : null,
    soft_pull: softPull,
    entitled: !!ent.entitled,
    steps,
    current_step: current
  };
}
