// Closer Dashboard live-call payload — everything needed for one client on one call.
// Assembles existing reads; does not invent credit or money numbers.

import { countUnlogged, listUnloggedCalls } from "./call-outcomes.mjs";
import { formatUsdFromCents, monthWindow } from "./metrics.mjs";
import { toCents } from "../commissions/money.mjs";
import { matchForClient } from "../lenders/store.mjs";
import { isSampleResult, triMerge } from "../http/client-detail.mjs";
import { toBureaus } from "../underwrite/adapter.mjs";
import { computeUnderwrite } from "../underwrite/engine.mjs";
import { applyStackedBusinessFunding } from "../underwrite/business-funding.mjs";
import { offersForClient } from "../config/offers.mjs";

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(n);
}

/* AN OPEN SHIFT NOBODY CLOSED IS NOT A SHIFT YOU ARE ON.
   Walk, 2026-09-06: the chip at the top of the call screen read
   "ON SHIFT · 370H 28M" — fifteen and a half days — because a `shifts` row
   started on 22 August has `ended_at IS NULL` and this file simply subtracted
   that timestamp from now. The row is real. The number off it is not a working
   day, and a closer reading it learns nothing about their own morning.

   A day is the bound, and it is not an invented figure: a shift still open more
   than twenty-four hours after it began was not ended, whatever else is true.
   Past that the chip stops counting and says what happened and when instead.
   The row itself is still reported — `started_at`, `elapsed_ms` and
   `never_closed` all ride on the payload — so nothing is hidden from a later
   reader, and whoever cleans the row up can still see it. */
const OPEN_SHIFT_MAX_MS = 24 * 60 * 60 * 1000;

export function describeShift(row, now = new Date()) {
  if (!row) return { on_shift: false, reason: "No open shift" };
  const startedAt = new Date(row.started_at);
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  if (elapsedMs <= OPEN_SHIFT_MAX_MS) {
    return { on_shift: true, started_at: row.started_at, elapsed_ms: elapsedMs };
  }
  const day = Number.isNaN(startedAt.getTime())
    ? null
    : startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return {
    on_shift: false,
    never_closed: true,
    started_at: row.started_at,
    elapsed_ms: Number.isFinite(elapsedMs) ? elapsedMs : null,
    reason: day
      ? `Shift open since ${day} — never clocked out`
      : "Shift open — never clocked out"
  };
}

/**
 * THE FUNDING NUMBER COMES FROM THE STORED FILE, NOT FROM A SECOND CALCULATION.
 *
 * Owner-set 2026-09-06, walk finding 9. This screen showed $636,000 while the
 * Client Control Panel showed $212,000 for the same client at the same moment.
 * Nothing was wrong with either calculation: there were simply two of them.
 * The Client Control Panel prints what was stored when credit was pulled; this
 * screen re-ran the underwriting engine over the tradeline rows and printed
 * that instead. A closer reads the number here out loud. Chris: "Nobody gets
 * 600K in funding."
 *
 * So there is one source now, and it is the stored pre-approval:
 *
 *   1. crs_results.result.preapprovals — totalPersonal / totalBusiness /
 *      totalCombined, written by the pull itself (src/finance/crs-pull.mjs,
 *      scripts/sim/push-credit.mjs).
 *   2. clients.custom_fields.analyzer_prequal_amount, else
 *      total_funding_estimate — the same two fields the Client Control Panel
 *      reads, in the same order (public/app/client-control-panel.html), for a
 *      file stamped before the preapprovals block was carried through.
 *
 * Three numbers, and only the three the owner asked for: personal, business,
 * total. No conservative band, no multiplier presented as a forecast.
 *
 * NULL SURVIVES (CLAUDE.md §12). A figure nobody stored is unknown, never zero,
 * and never re-derived here from something else. Where exactly one of the three
 * is missing and the other two are known it is filled by subtraction, which is
 * arithmetic on stored numbers rather than a second opinion about the client.
 */
export function storedFunding({ crsResult = null, customFields = {} } = {}) {
  const file = crsResult && typeof crsResult === "object" ? crsResult : {};
  const pre = file.preapprovals && typeof file.preapprovals === "object" ? file.preapprovals : {};
  const cf = customFields && typeof customFields === "object" ? customFields : {};

  let personal = money(pre.totalPersonal);
  let business = money(pre.totalBusiness);
  let total = money(pre.totalCombined);
  let source = (personal != null || business != null || total != null) ? "crs_preapprovals" : null;

  if (total == null) {
    const stamped = money(cf.analyzer_prequal_amount ?? cf.total_funding_estimate);
    if (stamped != null) {
      total = stamped;
      if (source == null) source = "client_custom_fields";
    }
  }

  if (total == null && personal != null && business != null) total = personal + business;
  if (personal == null && total != null && business != null) personal = total - business;
  if (business == null && total != null && personal != null) business = total - personal;

  const available = personal != null || business != null || total != null;
  return {
    available,
    personal,
    business,
    total,
    source,
    reason: available
      ? null
      : "No funding estimate on this file yet — pull credit to get one.",
    note: available
      ? "The stored pre-approval. The same figure the Client Control Panel prints."
      : null
  };
}

/**
 * buildCockpit(db, { orgId, staffId, clientId, now })
 */
export async function buildCockpit(db, { orgId, staffId, clientId, now = new Date() } = {}) {
  if (!orgId || !staffId || !clientId) {
    throw new TypeError("buildCockpit: orgId, staffId, clientId required");
  }

  const clientRes = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.channel_source,
            c.funded, c.funded_amount, c.outcome_tier, c.custom_fields, c.tags,
            b.name AS business_name, b.age_months,
            cf.utm_source, cf.utm_campaign, cf.utm_medium, cf.cf_setter_user_id
       FROM clients c
       LEFT JOIN businesses b ON b.client_id = c.id AND b.org_id = c.org_id
       LEFT JOIN client_custom_fields cf ON cf.client_id = c.id AND cf.org_id = c.org_id
      WHERE c.id = $1 AND c.org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const window = monthWindow(now);

  const [
    shift,
    kpis,
    unlogged,
    upNext,
    goneQuiet,
    card,
    crs,
    tradelines,
    liabilities,
    businesses,
    underwriteHint,
    conv,
    messages,
    lenders,
    apps,
    recentTx,
    templatesSent
  ] = await Promise.all([
    db.query(
      `SELECT id, started_at FROM shifts
        WHERE org_id = $1 AND staff_id = $2 AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`,
      [orgId, staffId]
    ),
    db.query(
      `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cash_cents,
              count(*) FILTER (WHERE outcome = 'deposit' AND transaction_id IS NOT NULL AND cash_collected_cents > 0)::int AS deposits,
              count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
              count(*) FILTER (WHERE outcome = 'no_show')::int AS no_shows
         FROM call_outcomes
        WHERE org_id = $1 AND staff_id = $2
          AND logged_at >= $3 AND logged_at < $4`,
      [orgId, staffId, window.start.toISOString(), window.end.toISOString()]
    ),
    countUnlogged(db, { orgId, staffId }),
    upcomingCalls(db, { orgId, staffId, includeClientId: clientId }),
    quietClients(db, { orgId, staffId }),
    db.query(
      `SELECT ps.key AS stage_key, ps.name AS stage_name, p.key AS pipeline_key
         FROM cards card
         JOIN pipeline_stages ps ON ps.id = card.stage_id
         JOIN pipelines p ON p.id = card.pipeline_id
        WHERE card.client_id = $1 AND card.org_id = $2
        ORDER BY card.updated_at DESC LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT result, created_at FROM crs_results
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT * FROM tradelines
        WHERE client_id = $1 AND org_id = $2
        ORDER BY apr ASC NULLS LAST, lender ASC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT * FROM card_liabilities
        WHERE client_id = $1 AND org_id = $2
        ORDER BY as_of DESC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT age_months FROM businesses
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at ASC`,
      [clientId, orgId]
    ),
    /* The round AND its closeout in one query. cockpit.mjs used to select the
       round id and throw it away, while the screen printed a hardcoded 10%.
       funding_closeout.fee_percent is the real number; a LEFT JOIN is what
       makes "no closeout row yet" survive as NULL instead of becoming 10. */
    db.query(
      `SELECT fr.id,
              fc.fee_percent, fc.total_fee, fc.total_approved_amount,
              fc.status AS closeout_status
         FROM funding_rounds fr
         LEFT JOIN funding_closeout fc
           ON fc.funding_round_id = fr.id AND fc.org_id = fr.org_id
        WHERE fr.client_id = $1 AND fr.org_id = $2
        ORDER BY fr.round_number DESC LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT id, channel, summary, sentiment, last_pulse_at, updated_at
         FROM conversations
        WHERE client_id = $1 AND org_id = $2
        ORDER BY COALESCE(last_pulse_at, updated_at) DESC NULLS LAST
        LIMIT 3`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT direction, channel, rendered_body, template_key, created_at, status
         FROM messages
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at DESC LIMIT 20`,
      [clientId, orgId]
    ),
    // Lender matches — computed, not a table.
    matchForClient(db, { orgId, clientId })
      .then((r) => r || { matches: [], match_count: 0 })
      .catch(() => ({ matches: [], match_count: 0 })),
    db.query(
      `SELECT a.id, a.status, a.lender_name, a.bank, a.approved_amount, a.requested_amount, a.created_at
         FROM applications a
        WHERE a.org_id = $2
          AND (a.client_id = $1 OR a.funding_round_id IN (
                SELECT id FROM funding_rounds WHERE client_id = $1 AND org_id = $2
              ))
        ORDER BY a.created_at DESC LIMIT 10`,
      [clientId, orgId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT id, product_name, amount_paid, status, created_at
         FROM transactions
        WHERE client_id = $1 AND org_id = $2
          AND status IN ('paid','succeeded','complete','completed')
        ORDER BY created_at DESC LIMIT 5`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT DISTINCT template_key FROM messages
        WHERE client_id = $1 AND org_id = $2
          AND template_key IS NOT NULL
        ORDER BY template_key
        LIMIT 20`,
      [clientId, orgId]
    )
  ]);

  const kpi = kpis.rows[0] || {};
  const held = Number(kpi.held || 0);
  const deposits = Number(kpi.deposits || 0);
  const staffRow = await db.query(`SELECT name FROM staff WHERE id = $1 AND org_id = $2`, [staffId, orgId]);

  const credit = summarizeCrs(crs.rows[0]);
  const underwriteAdapter = toBureaus({
    tradelines: tradelines.rows,
    liabilities: liabilities.rows,
    crsResults: crs.rows,
    customFields: client.custom_fields || {},
    businesses: businesses.rows
  });
  const underwriteData = applyStackedBusinessFunding(
    computeUnderwrite(
      underwriteAdapter.bureaus,
      underwriteAdapter.businessAgeMonths
    ),
    underwriteAdapter.businessAges
  );

  /* "DEROGATORIES: —" ON A FILE WITH NOTHING WRONG WITH IT. Walk finding 25.
     summarizeCrs looked for a key named exactly `derogatories` on the raw
     bureau payload. Walk1's file does not carry that name, so a client with
     four clean accounts and no negative items had the one fact that IS the
     pitch printed as unknown, on a live call.

     The count is already measured on this screen. The underwrite adapter reads
     clients.custom_fields.crs_negative_items_count and the engine carries it
     through as metrics.negative_accounts, and both of them keep UNKNOWN as null
     rather than coalescing it to zero — that rule is the whole subject of
     src/underwrite/adapter.mjs's header. So the answer is taken from the
     measurement this file already computes, instead of from a key name, and a
     count nobody has entered still reads as unknown rather than as clean. */
  if (credit.available && credit.derogatories == null) {
    const measured = money(underwriteData?.metrics?.negative_accounts);
    if (measured != null) {
      credit.derogatories = measured;
      credit.derogatories_source = "clients.custom_fields.crs_negative_items_count";
    }
  }

  /* ONE FUNDING NUMBER, SHARED WITH THE CLIENT CONTROL PANEL. See
     storedFunding() above for why. The engine's own arithmetic stays on the
     payload under `personal`, `business` and `per_bureau` as the record of what
     it computed; what the screen READS — totals — is the stored file, and
     `totals.source` says which of the two it is looking at.

     When nothing is stored the engine's totals are left exactly as they were,
     which is the no-credit-pull case: closer-call.js already prints a dash and
     the reason there, and a computed zero must never reach the screen as a
     confident $0 (src/sales/cockpit-honest-money.test.mjs). */
  const funding = storedFunding({
    crsResult: crs.rows[0]?.result,
    customFields: client.custom_fields
  });
  const underwriteTotals = funding.available
    ? {
        ...(underwriteData.totals || {}),
        total_personal_funding: funding.personal,
        total_business_funding: funding.business,
        total_combined_funding: funding.total,
        source: "stored_preapprovals"
      }
    : { ...(underwriteData.totals || {}), source: "engine" };

  const lenderMatch = gateLenderMatch({ credit, lenders });
  const precall = buildPrecall({
    client,
    conversations: conv.rows,
    messages: messages.rows
  });

  const depositProduct = recentTx.rows[0]
    ? {
        transaction_id: recentTx.rows[0].id,
        amount_cents: toCents(recentTx.rows[0].amount_paid),
        amount_display: formatUsdFromCents(toCents(recentTx.rows[0].amount_paid)),
        product_name: recentTx.rows[0].product_name,
        created_at: recentTx.rows[0].created_at
      }
    : null;

  /* THE SUCCESS FEE, FROM funding_closeout — not a constant.
     0.10 used to be hardcoded here, so the screen printed "10%" whatever the
     file said. fee_percent is a fraction (0.1000 = 10%). Where no closeout row
     exists the percent is the house default and `source` says so out loud, so
     the screen can label it a default instead of stating it as this round's
     agreed fee. */
  const closeoutRow = underwriteHint.rows[0] || null;
  const closeoutPct = closeoutRow && closeoutRow.fee_percent != null
    ? Number(closeoutRow.fee_percent)
    : null;
  const successFee = closeoutPct != null && Number.isFinite(closeoutPct)
    ? {
        success_fee_percent: closeoutPct,
        success_fee_source: "closeout",
        success_fee_note: "From this round's closeout record.",
        closeout_total_fee: money(closeoutRow.total_fee),
        closeout_total_approved: money(closeoutRow.total_approved_amount),
        closeout_status: closeoutRow.closeout_status || null
      }
    : {
        success_fee_percent: 0.10,
        success_fee_source: "default",
        success_fee_note: "House default — no closeout on this round yet.",
        closeout_total_fee: null,
        closeout_total_approved: null,
        closeout_status: null
      };

  /* THE TIME OF THIS CALL — one field, or null.
     upcomingCalls() orders THIS client's task first (see its ORDER BY), so the
     head of the list is this call when it belongs to this client and is some
     other client's call when it does not. The screen used to have to infer
     that; inferring it on a deep link to a client with no booked task produced
     a time that belonged to somebody else. */
  const headTask = upNext[0] || null;
  const currentCall = headTask && String(headTask.client_id) === String(clientId)
    ? { due_at: headTask.due_at, task_id: headTask.task_id, title: headTask.title || null }
    : null;
  /* And the one after it, asked of the table rather than read off up_next — see
     nextCallAfter() for the three shapes that array gets wrong. Always present
     on the payload: null means "no later call", never "we did not look". */
  const nextCall = currentCall
    ? await nextCallAfter(db, { orgId, staffId, after: currentCall.due_at })
    : null;

  return {
    staff: {
      id: staffId,
      name: staffRow.rows[0]?.name || null,
      shift: describeShift(shift.rows[0], now)
    },
    kpis: {
      cash_today_cents: await todayCash(db, { orgId, staffId, now }),
      cash_month_cents: Number(kpi.cash_cents || 0),
      cash_month_display: formatUsdFromCents(kpi.cash_cents),
      deposits,
      calls_held: held,
      no_shows: Number(kpi.no_shows || 0),
      close_rate: held ? deposits / held : null,
      unlogged,
      commission_mtd: null,
      commission_reason: "Open My numbers"
    },
    client: {
      id: client.id,
      /* The headline of the whole screen. "Client" read as a real answer —
         it looks like a name in a 32px h1. This says out loud that nobody
         typed one, so the closer knows to ask rather than to trust it. */
      name: [client.first_name, client.last_name].filter(Boolean).join(" ") || client.email || "Name not on file",
      slo_ref: (client.custom_fields && client.custom_fields.slo_ref) || null,
      slo_source: (client.custom_fields && client.custom_fields.slo_source) || null,
      slo_pack_status: (client.custom_fields && client.custom_fields.slo_pack_status) || null,
      last_pull_at: credit.pulled_at || null,
      business_name: client.business_name,
      city: null,
      state: null,
      location_reason: "City/state are not columns on client_custom_fields — address lives in pii_identity when captured",
      age_months: client.age_months,
      channel_source: client.channel_source,
      utm_campaign: client.utm_campaign,
      utm_source: client.utm_source,
      setter_key: client.cf_setter_user_id,
      tags: client.tags || [],
      funded: client.funded,
      pipeline: card.rows[0] || null
    },
    credit,
    /* The three numbers the owner asked for, on their own, named for what they
       are. Personal, business, total — one stored source, no bands. */
    funding,
    underwrite: {
      ...underwriteData,
      totals: underwriteTotals,
      funding_round_id: closeoutRow?.id || null,
      ...lenderMatch,
      applications: apps.rows
    },
    deal: {
      latest_payment: depositProduct,
      ...successFee
    },
    current_call: currentCall,
    next_call: nextCall,
    /* The offer catalog, so the closer can mint a pay link without leaving this
       screen. Pure config — offersForClient() reads no table — so this is not a
       second client read and the merge spec's one-data-path rule still holds. */
    offers: offersForClient(),
    precall,
    templates_sent: templatesSent.rows.map((r) => r.template_key),
    join_url: (await db.query(
      `SELECT meeting_url FROM tasks
        WHERE org_id = $1 AND client_id = $2
          AND meeting_url IS NOT NULL AND btrim(meeting_url) <> ''
        ORDER BY due_at DESC NULLS LAST
        LIMIT 1`,
      [orgId, clientId]
    )).rows[0]?.meeting_url || null,
    up_next: upNext,
    gone_quiet: goneQuiet,
    compliance_checklist: {
      items: [
        { id: "recorded", label: "Call is recorded" },
        { id: "personal_guarantee", label: "Personal guarantee" },
        { id: "month14", label: "Month-14 cliff" },
        { id: "bank_decides", label: "Bank decides, not us" },
        { id: "incorporation_verified", label: "Incorporation date verified — do not take their word" }
      ],
      never: ["guaranteed", "won't affect credit", "we have relationships", "0% forever"],
      recording_metrics: {
        available: false,
        reason: "Call recording and transcription do not exist yet"
      }
    },
    dispositions: {
      outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"],
      beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"],
      cash_note: "Cash, duration, recording and transcript log themselves — cash from the payment record only"
    }
  };
}

async function todayCash(db, { orgId, staffId, now }) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const r = await db.query(
    `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cents,
            count(*) FILTER (WHERE outcome = 'deposit' AND transaction_id IS NOT NULL AND cash_collected_cents > 0)::int AS deposits
       FROM call_outcomes
      WHERE org_id = $1 AND staff_id = $2 AND logged_at >= $3`,
    [orgId, staffId, start.toISOString()]
  );
  return {
    cents: Number(r.rows[0]?.cents || 0),
    display: formatUsdFromCents(r.rows[0]?.cents),
    deposits: Number(r.rows[0]?.deposits || 0)
  };
}

function summarizeCrs(row) {
  if (!row) {
    return {
      available: false,
      reason: "No crs_results row for this client yet",
      pulled_at: null
    };
  }
  const result = row.result || {};
  // Same bureau FICO extraction as Client Control Panel (triMerge) — raw
  // CRS scores use ex/eq/tu; the cockpit paint path reads experian/equifax/transunion.
  const merge = triMerge([row]);
  const scores = {
    experian: merge.experian,
    equifax: merge.equifax,
    transunion: merge.transunion
  };
  const signals = result.consumerSignals || result.consumer_signals || {};
  const utilPct = result.utilization ?? result.util
    ?? signals.utilization?.pct ?? signals.utilization?.percent
    ?? null;
  const inquiriesList = Array.isArray(result.inquiries) ? result.inquiries : null;
  return {
    available: true,
    pulled_at: merge.asOf || row.created_at,
    raw_keys: Object.keys(result).slice(0, 40),
    scores,
    /* True when this row is a sample report, never a bureau pull, so the
       closer never reads a sample out loud as a real pull (live hole 23). */
    sample: isSampleResult(result),
    utilization: money(utilPct),
    inquiries_6mo: money(
      result.inquiries_6mo
      ?? (inquiriesList ? inquiriesList.length : null)
      ?? (typeof result.inquiries === "number" ? result.inquiries : null)
    ),
    /* Whatever the raw payload happens to name it. Where it names it nothing,
       buildCockpit fills this from the measured negatives count — see the
       block beside the underwrite call. */
    derogatories: money(result.derogatories ?? result.derogs),
    derogatories_source: money(result.derogatories ?? result.derogs) != null ? "crs_result" : null,
    note: "Scores come from triMerge over the stored CRS payload; UnderwriteIQ projections sit beside this block in the same closer-call response."
  };
}

/**
 * THE LENDER COUNT IS GATED ON THE CREDIT FILE.
 *
 * F10, owner-set 2026-09-03. On 2026-09-03 this screen printed "307 lenders
 * match this file" three lines under "No credit pull on file yet" and "No
 * crs_results row for this client yet". A client with zero credit data matched
 * 307 lenders, and a closer could repeat that number to a customer on a live
 * call. Chris: with no credit pulled there should be no matched banks at all.
 *
 * So: no credit result, no count and no list. Never a number, never a zero —
 * zero is itself an answer about this client, and there is no answer yet.
 *
 * Funding finding 7 is the other half. matchLenders() now takes the credit
 * file and skips a lender whose own stated minimum score is above it — but no
 * lender in the table states one (0 of 313 rows in the CSV load path say
 * anything about a score), so the credit gate excludes nobody yet. So
 * `lenders_basis` is no longer a fixed sentence: it reports what the matcher
 * actually did to THIS count, and while the requirement data is missing it
 * says so instead of implying a screen that did not happen.
 *
 * @param {{ credit: object, lenders: object }} args
 */
export function gateLenderMatch({ credit = {}, lenders = {} } = {}) {
  if (!credit.available) {
    return {
      matched_lenders: null,
      lenders: [],
      lenders_reason: "No credit pull on file yet — pull credit to see lender matches.",
      lenders_gated_on: "credit_pull"
    };
  }
  const count = Number(lenders.match_count || lenders.matches?.length || 0);
  return {
    matched_lenders: count,
    lenders: lenders.matches || [],
    lenders_reason: count === 0
      ? "No lenders matched (empty lenders table or filters excluded all)"
      : null,
    lenders_basis: lendersBasis(lenders.summary && lenders.summary.credit),
    lenders_gated_on: null
  };
}

/* What this count was actually decided on, in the words a closer could repeat.
   Never claims the file was weighed when it was not. */
function lendersBasis(c) {
  if (!c || !c.available) {
    return "State and bureau eligibility. The credit file was not read into this match.";
  }
  const stated = Number(c.lenders_with_stated_minimum || 0);
  if (stated === 0) {
    return "State and bureau eligibility, plus this file's score. "
      + "No lender on the list records a minimum score, so the score ruled none of them out.";
  }
  const out = Number(c.lenders_excluded_on_score || 0);
  let line = `State and bureau eligibility, plus this file's score. ${stated} `
    + `lender${stated === 1 ? "" : "s"} record a minimum score; `
    + `${out} ${out === 1 ? "was" : "were"} ruled out on this file.`;
  const unread = Number(c.lenders_with_unreadable_requirement || 0);
  if (unread > 0) {
    line += ` ${unread} more mention${unread === 1 ? "s" : ""} a score in wording we could not read, `
      + "and were kept rather than dropped.";
  }
  return line;
}

function buildPrecall({ client, conversations, messages }) {
  const inbound = messages.filter((m) => m.direction === "inbound");
  const last = messages[0];
  const summary = conversations[0]?.summary
    || (inbound[0]?.rendered_body ? String(inbound[0].rendered_body).slice(0, 280) : null);
  const cf = client.custom_fields || {};
  return {
    conversation_count: messages.length,
    summary: summary || "No conversation summary on file yet.",
    sentiment: conversations[0]?.sentiment || null,
    wants: cf.funding_amount_requested || cf.amount_requested || cf.desired_funding || null,
    purpose: cf.use_of_funds || cf.funding_purpose || null,
    guessed_fico: cf.estimated_fico || cf.guessed_fico || null,
    last_message_at: last?.created_at || null,
    setter_key: client.cf_setter_user_id,
    lead_source: client.utm_campaign || client.utm_source || client.channel_source || null
  };
}

export async function upcomingCalls(db, { orgId, staffId, includeClientId }) {
  const r = await db.query(
    `SELECT t.id AS task_id, t.client_id, t.due_at, t.meeting_url, t.title,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS name
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
       LEFT JOIN call_outcomes o ON o.task_id = t.id
      WHERE t.org_id = $1
        AND t.assignee_role = 'closer'
        AND (t.assignee_staff_id = $2 OR t.assignee_staff_id IS NULL)
        AND t.due_at IS NOT NULL
        AND o.id IS NULL
        AND (
          (t.client_id = $3 AND t.due_at >= date_trunc('day', now()))
          OR
          (($3::uuid IS NULL OR t.client_id IS DISTINCT FROM $3) AND t.due_at >= now())
        )
      ORDER BY CASE WHEN t.client_id = $3 THEN 0 ELSE 1 END, t.due_at ASC
      LIMIT 5`,
    [orgId, staffId, includeClientId]
  );
  return r.rows;
}

/* THE CALL AFTER THIS ONE — asked as its own question, because up_next cannot
   answer it.

   up_next is not in time order and is not complete. Its ORDER BY forces every
   one of the open client's tasks to the front whatever the clock says, and then
   LIMIT 5 cuts the list. Measured against a real Postgres on 2026-08-31, three
   ordinary days break any answer read off that array:

     A) open client booked 3:00 PM, somebody else at 11:00 AM
        -> array order is 3:00 PM, 11:00 AM, so "next" was 11:00 AM: FOUR HOURS
           BEFORE the call it was printed beside.
     B) open client has 10:00 AM and 4:00 PM, somebody else at 11:00 AM
        -> array order is 10:00, 4:00 PM, 11:00, so "next" was 4:00 PM and the
           closer's real next appointment was never named. Six hours of runway
           on the screen, one hour in life.
     C) open client at 3:00 PM with five other calls at 9, 10, 11, 12 and 4:00 PM
        -> LIMIT 5 keeps 3:00 PM, 9, 10, 11, 12 and DROPS the 4:00 PM. Sorting
           the array by time still answers "nothing after this", which is false.

   C is why this is a query and not a loop: the honest answer is not in the array
   at any ordering. One row, ordered by time, no client weighting, no truncation.
   Returns null only when there genuinely is no later call.

   TWO time bounds, not one. `after` alone is not enough: this client's tasks are
   kept from date_trunc('day', now()) onward, so opening a client whose call was
   at 9:00 AM makes `after` a time in the PAST, and "the first row after 9:00 AM"
   can be a 10:00 AM that came and went and was never dispositioned. up_next has
   dropped that 10:00 AM already (it filters everybody else by due_at >= now()),
   so the headline named a finished call while the rail beside it named the real
   one. Both halves of the screen answer from the same clock or neither does. */
export async function nextCallAfter(db, { orgId, staffId, after }) {
  if (!after) return null;
  const r = await db.query(
    `SELECT nt.id AS task_id, nt.client_id, nt.due_at, nt.title,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS name
       FROM tasks nt
       LEFT JOIN clients c ON c.id = nt.client_id AND c.org_id = nt.org_id
       LEFT JOIN call_outcomes o ON o.task_id = nt.id
      WHERE nt.org_id = $1
        AND nt.assignee_role = 'closer'
        AND (nt.assignee_staff_id = $2 OR nt.assignee_staff_id IS NULL)
        AND nt.due_at IS NOT NULL
        AND o.id IS NULL
        AND nt.due_at > $3
        AND nt.due_at >= now()
      ORDER BY nt.due_at ASC
      LIMIT 1`,
    [orgId, staffId, after]
  );
  const row = r.rows[0];
  return row
    ? { due_at: row.due_at, task_id: row.task_id, client_id: row.client_id, name: row.name || null }
    : null;
}

async function quietClients(db, { orgId, staffId }) {
  const r = await listUnloggedCalls(db, { orgId, staffId, limit: 5 });
  // Also surface deposit-not-funded quiet — reuse cold query lightly
  const cold = await db.query(
    `SELECT c.id AS client_id,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), 'Client') AS name,
            EXTRACT(DAY FROM (now() - o.logged_at))::int AS quiet_days,
            o.cash_collected_cents
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id
      WHERE o.org_id = $1 AND o.staff_id = $2 AND o.outcome = 'deposit' AND o.transaction_id IS NOT NULL AND o.cash_collected_cents > 0
        AND c.funded IS NOT TRUE
        AND o.logged_at < now() - interval '7 days'
      ORDER BY o.logged_at ASC
      LIMIT 5`,
    [orgId, staffId]
  ).catch(() => ({ rows: [] }));
  return {
    unlogged: r,
    quiet_deposits: cold.rows
  };
}
