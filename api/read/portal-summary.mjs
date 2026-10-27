// GET /api/read/portal-summary — client-safe file summary for the portal.
//
// Returns pre-qual, 3-bureau + Experian business scores, client-safe document
// metadata, and whether an inquiry case is open (the portal's inquiry upload
// door hangs off that one flag). Clients read their own file only; staff may
// pass ?client_id= when previewing the portal.
//
// IT ALSO CARRIES THE THREE FACTS THE PORTAL USED TO GUESS AT (2026-09-03):
//
//   `stage`       — where the client actually is. The screen used to decide
//                   this from ONE entitlement code, so a client who had been
//                   pulled, had the call and signed a $5,000 agreement was
//                   still told "Your call is next" (walk finding F33).
//   `advisor`     — who looks after the file. The only read carrying a name was
//                   staff-gated, so a client always saw a blank one (F34).
//   `repair_path` — whether repair work belongs on this file at all. The
//                   dispute-letter authorization card was shown to everybody,
//                   including course buyers (F35).
//
// FACTS, NOT COPY. Every one of these is a boolean or a name; the words the
// client reads stay in public/app/client-portal.html. An endpoint that returns
// sentences is a second place to change the wording.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, redact } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { listClientLibrary } from "../../src/documents/retrieve.mjs";
import { secretFromEnv, DEFAULT_TTL_SECONDS } from "../../src/documents/signed-url.mjs";
import {
  formatPrequalUsd,
  portalCreditScores,
  prequalFromCustomFields
} from "../../src/http/portal-prequal.mjs";
import { onRepairPath } from "../../src/repair/on-repair-path.mjs";
import { mayAuthorizeDisputes } from "../../src/consent/dispute-consent.mjs";
import { invoiceDisplayNumber } from "../../src/invoices/index.mjs";
import { formatAmount, invoiceKindLabel } from "../../src/invoices/notify.mjs";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  let orgId = null;
  let clientId = null;

  if (principal.kind === "client") {
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!clientId || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
  } else {
    const staff = principal.staff || { role: principal.role };
    if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
    orgId = staff.org_id || null;
    if (!orgId) {
      return res.status(400).json({ ok: false, error: "org_required" });
    }
    const qid = req.query && req.query.client_id;
    if (qid != null && qid !== "" && !isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "invalid_client_id" });
    }
    clientId = qid || null;
    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: "client_id_required",
        message: "Pick a client to load portal summary."
      });
    }
  }

  /* FAIL CLOSED ON THE LINK, NOT ON THE PAGE.
     secretFromEnv() throws when DOCUMENT_URL_SECRET is missing or too short —
     that is the "no secret, no links" rule and it is correct. But signing runs
     inside the documents query here, so letting it throw would turn a missing
     config into a 500 for the client's ENTIRE file summary: scores, pre-qual,
     upload doors, all of it, gone because a link could not be signed. So the
     secret is checked once, up front. No secret means unsigned rows, which is
     exactly today's behaviour — the list still renders, and paintDocs() falls
     back to plain text for every row rather than offering a dead link.

     TTL: DEFAULT_TTL_SECONDS, fifteen minutes. These links are minted on every
     portal load whether or not anybody clicks one, so they are cheap to reissue
     and a reload always brings fresh ones — which argues for short. Fifteen
     minutes is the shortest window that still comfortably covers the real
     journey: land on the portal, read the page, open "Account & history",
     switch to the Documents tab, then click. Anything shorter starts expiring
     links under a client who is simply reading. Deliberately NOT the 7-day
     MAX_TTL_SECONDS: that is for a link inside an email, which has to survive a
     weekend; a link in a page the reader already has open does not.

     NO baseUrl, so the link is a same-origin PATH. Working an origin out from
     request headers means guessing a protocol — with no x-forwarded-proto it
     has to assume https, which is right behind Netlify and wrong against a
     plain-http dev server, where the link then will not load at all. The portal
     renders this link inside a page already served from this origin, so a path
     is both correct everywhere and one less thing to get wrong. */
  let signing = false;
  try {
    secretFromEnv();
    signing = { ttlSeconds: DEFAULT_TTL_SECONDS };
  } catch {
    signing = false;               // no secret, no links — the page still loads
  }

  try {
    const clientRes = await db.query(
      `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    const client = clientRes.rows[0];
    if (!client) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    const [documentsRes, crsRes, bizRes, inquiryRes] = await Promise.all([
      /* THE DOCUMENTS LIST NOW CARRIES A WORKING LINK.
         This was a hand-written SELECT over `documents` that signed nothing, so
         every row reached the portal with `download` undefined and
         paintDocs() (public/app/client-portal.html) silently fell back to plain
         text. The front end has always been built to render the link; there was
         simply never a link in the payload, so a client's uploaded ID or a
         letter we generated for them was openable exactly once — in the reply to
         its own upload, for fifteen minutes — and never again.

         listClientLibrary() is the reader that was written for this and had zero
         callers. It takes orgId AND clientId and throws without both, so the
         two-key scoping this endpoint depends on cannot be forgotten here the
         way src/http/read-api.mjs:150-153 records it being forgotten in ten
         other endpoints. */
      listClientLibrary(db, { orgId, clientId, sign: signing }),
      db.query(
        `SELECT id, outcome_tier, result, created_at, is_demo
           FROM crs_results
          WHERE client_id = $1 AND org_id = $2
            AND is_demo IS NOT TRUE
          ORDER BY created_at DESC`,
        [clientId, orgId]
      ),
      db.query(
        `SELECT name, age_months, entity_data
           FROM businesses
          WHERE client_id = $1 AND org_id = $2
          ORDER BY updated_at DESC
          LIMIT 5`,
        [clientId, orgId]
      ),
      /* THE INQUIRY UPLOAD DOOR HANGS OFF THIS ONE ROW.
         The portal's "Send a file" doors were gated only on entitlements, and
         the inquiry-removal product deliberately grants none
         (db/migrations/180_product_entitlements_seed.sql: "no shipped code
         anywhere says what an inquiry removal entitles the client to").
         So a client whose file says `inquiry:docs_needed` — asked by DOC-01 for
         an ID, proof of address and an authorization — read "0 unlocked" and
         had no door to send them through. An open case is a fact on the file,
         not an offer decision, so it is the honest gate. */
      db.query(
        `SELECT 1
           FROM inquiry_removal_cases
          WHERE client_id = $1 AND org_id = $2
            AND closed_at IS NULL
            AND is_demo IS NOT TRUE
          LIMIT 1`,
        [clientId, orgId]
      )
    ]);

    const cf = client.custom_fields || {};
    const prequalAmount = prequalFromCustomFields(cf);
    const scores = portalCreditScores({
      client,
      crsResults: crsRes.rows,
      businesses: bizRes.rows
    });

    /* THE STAGE READS AND THE ADVISOR READ FAIL SOFT, one by one.
       Everything above is the answer this endpoint has always given and the
       screen has always needed. These are additions, so a table that will not
       answer must cost the caller the fact it could not read and nothing else —
       the same reasoning as the signing block near the top of this file. */
    const [callHeld, signedAt, paid, advisor, invoiceDue, payments, sloPaid, upcomingCall] = await Promise.all([
      readCallHeld(orgId, clientId),
      readAgreementSignedAt(orgId, clientId),
      readPaymentPosted(orgId, clientId),
      readAdvisor(orgId, clientId, cf),
      readInvoiceDue(orgId, clientId),
      readPayments(orgId, clientId),
      readSloPaid(orgId, clientId),
      safeRead("upcoming call", { unavailable: true }, async () => {
        const r = await db.query(
          `SELECT id, starts_at FROM bookings
            WHERE org_id = $1 AND client_id = $2
              AND starts_at > now() AND status IN ('booked', 'rescheduled')
            ORDER BY starts_at ASC LIMIT 1`,
          [orgId, clientId]
        );
        const booking = r.rows[0];
        return booking ? { id: booking.id, when: booking.starts_at, confirmed: cf.call_confirmed === true } : null;
      })
    ]);

    /* SOFT PULL IS TRUE ON EITHER SIGNAL. The custom-field flags are set by the
       payment and analyzer handlers; a non-demo crs_results row is the pull
       itself having landed. On the 2026-09-03 walk the pull had run and the
       screen still said "we have not run those yet", so a real result row now
       counts on its own rather than waiting for a flag to be mirrored onto it. */
    const softPullComplete = cf.crs_paid === true
      || String(cf.analyzer_status || "").toLowerCase() === "complete"
      || crsRes.rows.length > 0;

    /* THE TIER IS READ INSIDE onRepairPath, not selected onto the client row
       above. Adding a column to that SELECT is tempting and costs more than it
       saves: src/http/simplify-implementation.test.mjs pins that exact statement
       as the proof this endpoint reads the SESSION's client and never the
       client_id a caller asked for, so widening it moves a security pin for a
       field the screen does not need. The repair answer is a boolean either way. */
    const repairPath = await onRepairPath(db, { orgId, clientId });

    /* AND WHETHER THEY MAY BE ASKED TO SIGN, which is a DIFFERENT question from
       the one above, and the owner's own words for it (2026-09-03): "It's only
       for repair and for the funding offer. If they're getting deliverables,
       meaning e-products and courses, they don't need to sign for shit."

       DIFFERENT, NOT WIDER, AND IT IS NOT `repairPath` PLUS SOMETHING. It is
       wider on one side — a funding customer is not a repair client and their
       letter pack still contains dispute work, so gating on `repair_path` alone
       left them unable to authorize the letters we owe them. It is NARROWER on
       the other — `repair_path` says yes on an outcome_tier of REPAIR_ONLY, and
       that tier is stamped by a real credit pull on course buyers too, so
       feeding this answer in re-opened F35 for exactly the buyer it was raised
       on. src/consent/dispute-consent.mjs therefore reads the two ENTITLEMENTS
       and no tier, and is asked on its own rather than handed `repairPath`. */
    const disputeConsent = await mayAuthorizeDisputes(db, { orgId, clientId });

    return res.status(200).json(redact({
      ok: true,
      prequal_amount: prequalAmount,
      prequal_display: formatPrequalUsd(prequalAmount),
      prequal_sample: cf.prequal_sample === true,
      scores,
      soft_pull_complete: softPullComplete,
      doc_agent_message: cf.doc_agent_message || null,
      inquiry_open: inquiryRes.rows.length > 0,
      documents: portalDocuments(documentsRes),
      // Whether repair work belongs on this file. A boolean rather than a tier
      // the screen would have to re-interpret — the rule lives in one place,
      // src/repair/on-repair-path.mjs, and the server applies the same one when
      // the signature is actually posted (api/consent/capture.mjs).
      repair_path: repairPath,
      // Whether the dispute-letter authorization card belongs on this screen at
      // all. Separate from repair_path on purpose: they are different questions
      // and they disagree for every funding customer. The card reads THIS one.
      dispute_consent: disputeConsent,
      /* WHAT SHE OWES, AND THE LINK THAT LETS HER PAY IT. See readInvoiceDue.
         null means the read failed — the screen must say it could not check,
         never print a zero. `{ count: 0 }` means it read, and nothing is owed. */
      invoice_due: invoiceDue,
      /* WHAT SHE HAS ALREADY PAID. The same shape /api/dashboard/client returns
         for staff, so the Payments tab paints one list either way. null means
         the read failed — the screen must say it could not check, never print
         "no payments yet" over a payment that exists. */
      payments,
      /* A PAID SLO ROADMAP ORDER. The screen opens the Capital Blueprint tile
         on this — see readSloPaid. */
      slo_paid: sloPaid,
      advisor,
      upcoming_call: upcomingCall,
      stage: portalStage({
        softPullComplete,
        callHeld,
        agreementSignedAt: signedAt,
        paymentPosted: paid
      })
    }));
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "read_failed",
      message: "Something went wrong loading your file summary.",
      detail: safeError(err)
    });
  }
}

/* ── THE STAGE, AND THE FOUR FACTS UNDER IT ─────────────────────────────────
 *
 * WHAT WAS WRONG. The portal decided its whole stage from ONE entitlement code,
 * `funding-snapshot`: hold it and the screen said "Where your funding is", miss
 * it and the screen said "Before your call" — forever. So a client who had been
 * credit-pulled, had the call, and signed a $5,000 agreement was still greeted
 * with "Your call is next" and told "we have not run those yet". Walk finding
 * F33, 2026-09-03.
 *
 * FOUR FACTS, EACH FROM THE TABLE THAT OWNS IT, none of them derived from any of
 * the others. A client can pay before signing, or sign before the pull lands, and
 * a chain of ifs that assumes one order gets those people wrong. So each is read
 * on its own and `key` is simply the furthest one reached.
 *
 * ORDER OF THE LADDER: booked → soft_pull → call_held → agreement_signed → paid.
 * That is the journey the SOP walks and the order the stepper on the screen
 * already draws.
 */
export function portalStage({ softPullComplete, callHeld, agreementSignedAt, paymentPosted }) {
  const facts = {
    soft_pull_complete: !!softPullComplete,
    call_held: !!callHeld,
    agreement_signed: !!agreementSignedAt,
    payment_posted: !!paymentPosted
  };
  let key = "booked";
  if (facts.soft_pull_complete) key = "soft_pull";
  if (facts.call_held) key = "call_held";
  if (facts.agreement_signed) key = "agreement_signed";
  if (facts.payment_posted) key = "paid";
  return {
    key,
    // "Has anything at all happened yet?" is the one question the screen asks
    // most often — it is what separates the before-the-call copy from the rest —
    // so it is answered here rather than by four comparisons on the client.
    before_call: key === "booked",
    /* NAMED contract_signed_at ON PURPOSE, not agreement_signed_at. That other
       name belongs to partners.agreement_signed_at, the single column standing
       between an unsigned partner and a payout (042_partners.sql), and
       src/contracts/partner-license-terms.test.mjs greps every file under src/
       and api/ for it so a new writer cannot appear unnoticed. This field is the
       CLIENT's signed agreement date for the portal stage ladder and touches no
       partner row, so it must not answer to that grep. */
    contract_signed_at: agreementSignedAt || null,
    ...facts
  };
}

/* A read that must never take the rest of the answer down with it. Returns the
   fallback and warns; the caller treats that as "we could not find out", which
   for every fact below is the same as "not yet", and the screen's before-call
   copy is the honest thing to show when we do not know. */
async function safeRead(label, fallback, run) {
  try {
    return await run();
  } catch (err) {
    console.warn(`[portal-summary] ${label} read failed:`, err && err.message);
    return fallback;
  }
}

/* THE CALL HAPPENED — two independent witnesses, either will do.
   `call.completed` is the event the automations key off (see callHappened() in
   src/workflows/dpc-02-call-outcome-enforcement.mjs). A `call_outcomes` row is a
   closer having typed a disposition afterwards, which is the stronger evidence
   of the two and does not depend on any webhook having fired. A no-show is
   excluded: the appointment resolved, the call did not happen. */
function readCallHeld(orgId, clientId) {
  return safeRead("call_held", false, async () => {
    const r = await db.query(
      `SELECT
         EXISTS (SELECT 1 FROM events
                  WHERE org_id = $1 AND client_id = $2 AND name = 'call.completed') AS by_event,
         EXISTS (SELECT 1 FROM call_outcomes
                  WHERE org_id = $1 AND client_id = $2
                    AND outcome <> 'no_show'
                    AND is_demo IS NOT TRUE) AS by_outcome`,
      [orgId, clientId]
    );
    return r.rows[0]?.by_event === true || r.rows[0]?.by_outcome === true;
  });
}

/* ANY signed agreement, not a named template. 124's contracts_signed_status_ck
   means signed_at is only ever set on a row whose status is 'signed', so the two
   cannot disagree. The date comes back because the screen says what was signed
   and when, and re-deriving it from the agreements list would be a second read
   of the same fact. */
function readAgreementSignedAt(orgId, clientId) {
  return safeRead("agreement_signed", null, async () => {
    const r = await db.query(
      `SELECT signed_at FROM contracts
        WHERE org_id = $1 AND client_id = $2 AND status = 'signed'
        ORDER BY signed_at DESC NULLS LAST
        LIMIT 1`,
      [orgId, clientId]
    );
    return r.rows[0]?.signed_at || null;
  });
}

/* MONEY ACTUALLY POSTED. 'succeeded' is the only success value anything writes
   (src/handlers/client-lifecycle.mjs:recordTransaction and src/slo/purchase.mjs);
   'failed' is the other one. Matching the exact string rather than "not failed"
   keeps a future status nobody has defined from silently counting as paid. */
function readPaymentPosted(orgId, clientId) {
  return safeRead("payment_posted", false, async () => {
    const r = await db.query(
      `SELECT 1 FROM transactions
        WHERE org_id = $1 AND client_id = $2
          AND status = 'succeeded'
          AND is_demo IS NOT TRUE
        LIMIT 1`,
      [orgId, clientId]
    );
    return r.rows.length > 0;
  });
}

/* SHE PAID FOR THE SLO ROADMAP — the Capital Blueprint pack.
   That order sells on product 'diagnostic', which grants only
   credit-analysis-report, so no entitlement can answer this. The order itself
   does: a /roadmap Commas order row (link_ref slo_*) the webhook marked paid,
   or the transaction the ClickFunnels SLO webhook writes (src/slo/purchase.mjs,
   raw_payload.source 'slo'). Not slo_ref on the client — src/slo/pull.mjs
   stamps that before payment can clear. Demo rows never count. */
function readSloPaid(orgId, clientId) {
  return safeRead("slo_paid", false, async () => {
    const r = await db.query(
      `SELECT
         EXISTS (SELECT 1 FROM payment_links
                  WHERE org_id = $1 AND client_id = $2
                    AND link_ref LIKE 'slo\\_%'
                    AND status = 'paid'
                    AND is_demo IS NOT TRUE) AS by_order,
         EXISTS (SELECT 1 FROM transactions
                  WHERE org_id = $1 AND client_id = $2
                    AND status = 'succeeded'
                    AND is_demo IS NOT TRUE
                    AND raw_payload->>'source' = 'slo') AS by_funnel`,
      [orgId, clientId]
    );
    return r.rows[0]?.by_order === true || r.rows[0]?.by_funnel === true;
  });
}

/* WHAT SHE ACTUALLY PAID — the list, not just the yes/no above.
   readPaymentPosted answers one question the stage machine asks; the Payments
   tab needs the rows themselves. The column list is the one
   api/dashboard/client.mjs already selects for the same pane, so the screen's
   painter takes one row shape from either read and needs no second branch.

   Only 'succeeded', only non-demo, newest first: the same two filters as the
   boolean above, for the same reason — a status nobody has defined must never
   print to a client as money received. Capped at 20, which is what the painter
   showed before this read existed.

   FAILS SOFT AS null, like every read in this file. An empty array is "you have
   paid nothing"; null is "we could not check". Printing the first when we mean
   the second is how a client is told their payment vanished. */
function readPayments(orgId, clientId) {
  return safeRead("payments", null, async () => {
    const r = await db.query(
      `SELECT id, product_name, amount_paid, status, created_at
         FROM transactions
        WHERE org_id = $1 AND client_id = $2
          AND status = 'succeeded'
          AND is_demo IS NOT TRUE
        ORDER BY created_at DESC
        LIMIT 20`,
      [orgId, clientId]
    );
    return r.rows;
  });
}

/* ── WHAT SHE OWES ──────────────────────────────────────────────────────────
 *
 * COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — fee timing and payment rails.
 * This puts a dollar figure and an existing checkout link in front of a client.
 * It states no credit outcome and makes no claim; it reports a bill that was
 * already raised and already emailed.
 *
 * WHAT WAS WRONG (walk finding, 2026-09-06). Walk1 Funding's round funded, the
 * platform raised a $5,000 success-fee invoice, marked it sent, minted a working
 * checkout link for it, and emailed her chasing payment at 11:21. She then
 * opened her portal to pay and the Payments tab showed the words "Success Fee"
 * with a DASH where the amount belongs, and under it "No payments yet". Nothing
 * on that screen has ever read the invoices table, so there was no number to
 * print and no link to click. We asked a real customer for five thousand dollars
 * and then gave her no way to hand it over.
 *
 * ONLY WHAT IS STILL OWED. open_balance is 031's computed figure — amount_due
 * minus everything paid, forced to 0 for void and written_off — so a settled or
 * cancelled invoice is simply absent rather than being listed as $0.
 *
 * THE PAY LINK IS FOUND, NOT MINTED. src/workflows/ar-collections.mjs already
 * creates one payment_links row per success-fee invoice and puts it in the chase
 * email. This is a READ endpoint: it hands back the link that exists, and null
 * when there is not one. It never creates one, never calls a provider, and a
 * link already marked paid, expired, or void is not offered.
 *
 * FAILS SOFT, like every other read below it: null, so the screen can say it
 * could not check. A read that cannot answer must never come back as $0 owed.
 */
function readInvoiceDue(orgId, clientId) {
  return safeRead("invoice_due", null, async () => {
    const r = await db.query(
      `SELECT v.invoice_id      AS id,
              v.source,
              v.status,
              v.currency,
              v.amount_due,
              v.amount_paid,
              v.open_balance,
              v.due_at,
              v.sent_at,
              pay.checkout_url
         FROM v_invoice_aging v
         JOIN invoices i ON i.id = v.invoice_id
         LEFT JOIN LATERAL (
           SELECT pl.checkout_url
             FROM payment_links pl
            WHERE pl.invoice_id = v.invoice_id
              AND pl.org_id     = v.org_id
              AND pl.checkout_url IS NOT NULL
              AND pl.status IN ('created', 'sent')
              AND pl.amount_cents = (v.open_balance * 100)::bigint
              AND (pl.provider = 'commas' OR (
                v.source IS DISTINCT FROM 'funding_success_fee'
                AND i.invoice_type IS DISTINCT FROM 'success_fee'
              ))
              AND COALESCE(pl.is_demo, false) = false
            ORDER BY pl.created_at DESC
            LIMIT 1
         ) pay ON TRUE
        WHERE v.org_id = $1 AND v.client_id = $2
          AND v.open_balance > 0
          AND COALESCE(i.is_demo, false) = false
        ORDER BY v.due_at ASC NULLS LAST, v.created_at ASC`,
      [orgId, clientId]
    );

    const items = r.rows.map((row) => ({
      // The same INV-XXXXXXXX she already has on the emailed invoice.
      reference: invoiceDisplayNumber(row),
      kind: invoiceKindLabel(row),
      amount: Number(row.open_balance),
      amount_display: formatAmount(row.open_balance, row.currency),
      currency: row.currency || "USD",
      status: row.status || null,
      due_at: row.due_at || null,
      sent_at: row.sent_at || null,
      // null is a real answer: there is a bill, and no link to pay it online.
      pay_url: row.checkout_url || null
    }));

    const total = items.reduce((sum, it) => sum + (Number.isFinite(it.amount) ? it.amount : 0), 0);
    const currency = items.length ? items[0].currency : "USD";

    return {
      count: items.length,
      currency,
      total,
      total_display: formatAmount(total, currency),
      items
    };
  });
}

/* WHO LOOKS AFTER THIS FILE — and null rather than a guess.
 *
 * The portal's advisor panel used to read GET /api/dashboard/client, which is
 * staff-gated and 401s for the person whose file it is, so a client ALWAYS saw a
 * blank name (walk finding F34). The name has to come from a read the client is
 * allowed to make, which is this one.
 *
 * THREE SOURCES, MOST EXPLICIT FIRST, and `source` says which one answered:
 *   custom_field  — a name typed onto the client record
 *   staff_link    — clients.custom_fields.cf_funding_advisor_user_id, the column
 *                   db/schema/005 defines for exactly this, resolved to a staff row
 *   call_outcome  — the funding advisor who logged a call on this file
 *
 * A CLOSER IS NOT A FUNDING ADVISOR and is deliberately not a fourth source.
 * Closers sell; funding advisors submit the applications. Naming the closer under
 * a panel headed "Your Funding Advisor" would be a confident wrong answer, which
 * is worse than the empty state the screen now has words for.
 *
 * NOTHING BUT A NAME AND A ROLE LEAVES HERE. No email, no phone, no staff id —
 * the panel's only action is the chat widget, so a contact detail in this payload
 * would be exposure with no use.
 */
function readAdvisor(orgId, clientId, cf) {
  return safeRead("advisor", null, async () => {
    const typed = firstNonEmpty([
      cf.advisor_name, cf.assigned_advisor, cf.funding_advisor
    ]);
    if (typed) return { name: typed, role: "funding_advisor", source: "custom_field" };

    const linked = firstNonEmpty([cf.cf_funding_advisor_user_id]);
    if (linked) {
      const r = await db.query(
        `SELECT name, role FROM staff
          WHERE id::text = $1 AND org_id = $2 AND status <> 'suspended'`,
        [linked, orgId]
      );
      const s = r.rows[0];
      if (s && s.name) return { name: s.name, role: s.role || null, source: "staff_link" };
    }

    const r = await db.query(
      `SELECT s.name, s.role
         FROM call_outcomes o
         JOIN staff s ON s.id = o.staff_id AND s.org_id = o.org_id
        WHERE o.org_id = $1 AND o.client_id = $2
          AND o.is_demo IS NOT TRUE
          AND s.role = 'funding_advisor'
          AND s.status <> 'suspended'
        ORDER BY o.logged_at DESC
        LIMIT 1`,
      [orgId, clientId]
    );
    const s = r.rows[0];
    return s && s.name
      ? { name: s.name, role: s.role || null, source: "call_outcome" }
      : null;
  });
}

function firstNonEmpty(values) {
  for (const v of values) {
    const s = v == null ? "" : String(v).trim();
    if (s) return s;
  }
  return null;
}

/* portalDocuments — listClientLibrary()'s rows, narrowed back to exactly the
 * fields this endpoint has always returned, plus `download`.
 *
 * THE NARROWING IS THE SECURITY-RELEVANT PART, not a tidy-up. listClientLibrary
 * selects the registry's full public column set, which is right for its other
 * callers and wrong to hand a consumer: it carries `metadata` — for an upload
 * that holds the original filename and an `uploaded_by` object naming the STAFF
 * MEMBER's id — plus `checksum`, `generated_by`, `signer_ref`, `org_id` and
 * `current_version_id`. None of that was in this response yesterday and none of
 * it is anything a client's portal needs. Passing the rows straight through
 * would have been a quiet widening of what a consumer can read about their own
 * file and about the people handling it. The allow-list below is the whole
 * defence, so add to it only deliberately.
 *
 * ORDER AND LIMIT ARE PRESERVED DELIBERATELY. The old SELECT was
 * `ORDER BY created_at DESC LIMIT 50`; listClientLibrary orders by kind and
 * takes everything. Re-sorting and slicing here keeps the portal's list in the
 * order the client already knows and keeps the payload the same size, so this
 * change adds a link and changes nothing else on the screen.
 *
 * AN EXPIRED DOCUMENT GETS NO LINK. api/documents/[id].mjs refuses an expired
 * document even with a valid signature, so a link on one of those rows would be
 * a control that cannot finish. The row still appears — an expired soft-pull
 * authorization is still something the client owns and may need to see.
 */
function portalDocuments(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 50)
    .map((d) => ({
      id: d.id,
      document_key: d.document_key,
      kind: d.kind,
      subtype: d.subtype,
      title: d.title,
      mime_type: d.mime_type,
      byte_size: d.byte_size,
      generated_at: d.generated_at,
      delivered_at: d.delivered_at,
      delivery_channel: d.delivery_channel,
      delivery_status: d.delivery_status,
      signature_required: d.signature_required,
      signed_at: d.signed_at,
      created_at: d.created_at,
      download: d.expired ? null : (d.download || null)
    }));
}
