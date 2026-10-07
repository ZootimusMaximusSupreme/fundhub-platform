// The derived fields the Closer Dashboard needs and api/dashboard/client.mjs
// did not carry: tier reasoning, tri-merge scores, a utilisation band, and open
// blockers.
//
// Pure functions over rows that endpoint already fetches, so this is testable
// without a database and adds no queries.

import { pickCreditScore } from "../finance/crs-map.mjs";
//
// NOTHING IS INVENTED. Every value is derived from something the analyzer
// actually stored. crs_results.result is the raw analysis.completed payload
// (src/handlers/client-lifecycle.mjs:135), so `scores` and `utilization` are read
// from there if the analyzer sent them and reported as null if it did not — a
// screen showing "—" is correct; a screen showing a made-up 720 is not.

/* FICO range only. IncomeView / other bureau add-ons (e.g. Equifax 42) are
   not credit scores and must not paint on a card. */
const FICO_MIN = 300;
const FICO_MAX = 850;
const FICO_MODEL = /fico|fair\s*isaac/i;

function ficoOf(value, model) {
  const n = num(value);
  if (n === null || n < FICO_MIN || n > FICO_MAX) return null;
  if (model && String(model).trim() && !FICO_MODEL.test(String(model))) return null;
  return n;
}

function scoresFromResult(result) {
  const s = (result && result.scores) || {};
  const m = (result && (result.scoreModels || result.score_models)) || {};
  const fromCache = {
    experian: ficoOf(s.ex ?? s.experian, m.ex ?? m.experian),
    equifax: ficoOf(s.eq ?? s.equifax, m.eq ?? m.equifax),
    transunion: ficoOf(s.tu ?? s.transunion, m.tu ?? m.transunion)
  };
  const bureaus = result && result.bureaus;
  if (!bureaus || typeof bureaus !== "object") return fromCache;
  return {
    experian: fromCache.experian ?? ficoFromBureau(bureaus.EX),
    equifax: fromCache.equifax ?? ficoFromBureau(bureaus.EQ),
    transunion: fromCache.transunion ?? ficoFromBureau(bureaus.TU)
  };
}

function ficoFromBureau(report) {
  if (!report || typeof report !== "object") return null;
  const { value, model } = pickCreditScore(report.scores);
  return ficoOf(value, model);
}

/* isSampleResult — was this stored report a walkthrough's SAMPLE, never a
   bureau pull? scripts/sim/push-credit.mjs and src/demo/simulate-client.mjs
   stamp it environment "simulated" (push-credit also sets simulated:true) so
   every screen can tell. The same test as isSampleReport() in
   public/app/client-control-panel.html (live hole 23). Unreadable answers
   false, so a real pull is never labelled. Never throws. */
export function isSampleResult(result) {
  const r = safeObject(result);
  if (!r || typeof r !== "object") return false;
  return r.simulated === true || String(r.environment || "").toLowerCase() === "simulated";
}

/* triMerge — the three bureau FICOs from the most recent CRS result that
   actually has one. Returns { experian, equifax, transunion, spread, asOf,
   source, sample } with nulls where the analyzer sent nothing usable.
   `sample` is true when that result is a sample report (isSampleResult). */
export function triMerge(crsResults = []) {
  const empty = { experian: null, equifax: null, transunion: null,
                  spread: null, asOf: null, source: null, sample: false };
  const latest = latestWithScores(crsResults);
  if (!latest) return empty;

  const { experian, equifax, transunion } = latest.scores;
  const present = [experian, equifax, transunion].filter((v) => v !== null);
  return {
    experian, equifax, transunion,
    spread: present.length >= 2 ? Math.max(...present) - Math.min(...present) : null,
    asOf: latest.created_at || null,
    source: present.length ? "crs_results" : null,
    sample: isSampleResult(latest.result)
  };
}

function latestWithScores(crsResults) {
  for (const r of [...(crsResults || [])].sort(byNewest)) {
    const result = safeObject(r.result);
    if (!result) continue;
    // Sandbox fixtures are not this person's credit file. Never paint them.
    if (String(result.environment || "").toLowerCase() === "sandbox") continue;
    const scores = scoresFromResult(result);
    if (scores.experian != null || scores.equifax != null || scores.transunion != null) {
      return { ...r, result, scores };
    }
  }
  return null;
}

function byNewest(a, b) {
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* UTILISATION BANDS. The thresholds are the standard credit-utilisation bands
   the roadmap is written against; they are a presentation grouping over a number
   the analyzer supplied, not a scoring model of our own. A missing utilisation
   yields band null rather than "unknown" masquerading as a band. */
export const UTILISATION_BANDS = [
  { band: "excellent", max: 10 },
  { band: "good",      max: 30 },
  { band: "high",      max: 50 },
  { band: "severe",    max: Infinity }
];

export function utilisation(crsResults = [], client = {}) {
  const latest = [...(crsResults || [])].sort(byNewest)
    .map((r) => ({ ...r, result: safeObject(r.result) }))
    .find((r) => r.result && r.result.utilization !== undefined);

  const pct = latest ? num(latest.result.utilization)
                     : num(client && client.custom_fields && client.custom_fields.utilization);
  if (pct === null) return { percent: null, band: null, asOf: null };

  const band = UTILISATION_BANDS.find((b) => pct <= b.max).band;
  return { percent: pct, band, asOf: latest ? latest.created_at || null : null };
}

/* TIER REASONING. Why this client landed on this tier, in the words of the data
   that decided it. Deliberately NOT a re-derivation of the tier: re-running the
   decision here could disagree with the stored one, and the stored one is what
   the client was told. This explains, it does not recompute. */
export function tierReasoning(client = {}, crsResults = []) {
  const tier = client.outcome_tier || null;
  const cf = client.custom_fields || {};
  const latest = [...(crsResults || [])].sort(byNewest)
    .map((r) => ({ ...r, result: safeObject(r.result) }))[0];
  const payload = (latest && latest.result) || {};

  const factors = [];
  const scores = triMerge(crsResults);
  if (scores.experian !== null || scores.equifax !== null || scores.transunion !== null) {
    factors.push({
      factor: "tri_merge",
      detail: `EX ${fmt(scores.experian)} · EQ ${fmt(scores.equifax)} · TU ${fmt(scores.transunion)}`
    });
  }
  const util = utilisation(crsResults, client);
  if (util.percent !== null) {
    factors.push({ factor: "utilisation", detail: `${util.percent}% (${util.band})` });
  }
  const estimate = cf.total_funding_estimate ?? payload.fundingEstimate ?? null;
  if (estimate !== null && estimate !== undefined && estimate !== "") {
    factors.push({ factor: "funding_estimate", detail: String(estimate) });
  }
  if (payload.reason) factors.push({ factor: "analyzer_reason", detail: String(payload.reason) });

  return {
    tier,
    decidedAt: latest ? latest.created_at || null : null,
    // A tier with nothing behind it is a real state worth surfacing — it means
    // the tier was set without a CRS result to explain it.
    unexplained: !!tier && factors.length === 0,
    factors
  };
}

function fmt(v) { return v === null ? "—" : String(v); }

const CRS_INCOMPLETE_TASK = "Cannot start funding — CRS incomplete";
const AWAITING_CRS = "Awaiting CRS";

/** True when the same scores the control panel paints are on file. */
export function hasPaintedScores(crsResults) {
  const tm = triMerge(crsResults);
  return tm.experian != null || tm.equifax != null || tm.transunion != null;
}

/* OPEN BLOCKERS — what is actually stopping this file moving, assembled from
   rows the endpoint already has. Each blocker names its source so a closer can
   act on it rather than guessing what produced it. */
export function openBlockers({ client = {}, tasks = [], fundingRounds = [], invoices = [], crsResults } = {}) {
  const cf = client.custom_fields || {};
  const scoresOnFile = hasPaintedScores(crsResults);
  const blockers = [];

  for (const t of tasks.filter((t) => !t.done)) {
    if (scoresOnFile && String(t.title || "") === CRS_INCOMPLETE_TASK) continue;
    blockers.push({
      kind: "task", severity: "normal",
      label: t.title,
      detail: t.assignee_role ? `owned by ${t.assignee_role}` : "unassigned",
      source: t.source_workflow || "task", id: t.id
    });
  }

  for (const r of fundingRounds.filter((r) => r.hold_reason)) {
    if (scoresOnFile && String(r.hold_reason || "").trim() === AWAITING_CRS) continue;
    blockers.push({
      kind: "funding_hold", severity: "high",
      label: `Round ${r.round_number} on hold`,
      detail: r.hold_reason, source: "funding_rounds", id: r.id
    });
  }

  for (const inv of invoices.filter((i) => Number(i.balance_due || 0) > 0)) {
    const overdue = inv.due_at && new Date(inv.due_at) < new Date();
    blockers.push({
      kind: "balance_due", severity: overdue ? "high" : "normal",
      label: overdue ? "Invoice overdue" : "Balance outstanding",
      detail: `${inv.currency || "USD"} ${inv.balance_due}`,
      source: "invoices", id: inv.id || inv.invoice_id
    });
  }

  // The two gates the journey actually stops on, read from the flags the
  // workflows maintain rather than inferred.
  if (cf.crs_paid === false) {
    blockers.push({ kind: "gate", severity: "high", label: "CRS not paid",
                    detail: "the analysis gate is unpaid", source: "custom_fields.crs_paid" });
  }
  if (cf.deposit_paid === false && cf.sale_closed === true) {
    blockers.push({ kind: "gate", severity: "high", label: "Deposit outstanding",
                    detail: "sale closed with no deposit recorded",
                    source: "custom_fields.deposit_paid" });
  }

  const order = { high: 0, normal: 1 };
  blockers.sort((a, b) => order[a.severity] - order[b.severity]);
  return blockers;
}

/* Income Insight (Experian) / IncomeView+ (Equifax) — yearly income GUESSES
   from the credit file. Not bank balances. Not FICO.
   CRS returns the estimate as a short number (e.g. 97 → $97,000/year). */
const INCOME_EX = /income\s*insight/i;
const INCOME_EQ = /income\s*view/i;

function incomeRowFromScores(scores, modelRe) {
  for (const s of (Array.isArray(scores) ? scores : [])) {
    const model = String(s?.modelName ?? "").trim();
    if (!modelRe.test(model)) continue;
    const raw = num(s?.scoreValue);
    if (raw === null || raw <= 0) continue;
    /* Bureau income products return thousands of dollars as the score. */
    const annual = raw < 1000 ? Math.round(raw * 1000) : Math.round(raw);
    if (annual < 1000 || annual > 2_000_000) continue;
    return { annual, raw, model };
  }
  return null;
}

export function incomeEstimates(crsResults = []) {
  const empty = { experian: null, equifax: null, asOf: null };
  for (const r of [...(crsResults || [])].sort(byNewest)) {
    const result = safeObject(r.result);
    if (!result) continue;
    if (String(result.environment || "").toLowerCase() === "sandbox") continue;
    const bureaus = result.bureaus && typeof result.bureaus === "object" ? result.bureaus : {};
    const experian = incomeRowFromScores(bureaus.EX?.scores, INCOME_EX);
    const equifax = incomeRowFromScores(bureaus.EQ?.scores, INCOME_EQ);
    if (experian || equifax) {
      return { experian, equifax, asOf: r.created_at || result.pulledAt || null };
    }
  }
  return empty;
}

/* clientDetailExtras — everything above, in one call, for the endpoint. */
/* Business credit as stored — Intelliscore / FSR are 1–100, not FICO.
   Missing data stays null. Nothing is invented. */
function firstScore100(values) {
  for (const v of values) {
    const n = num(v);
    if (n !== null && n >= 0 && n <= 100) return n;
  }
  return null;
}

function formatBusinessAddress(entity) {
  const line1 = entity.address_line1 ? String(entity.address_line1) : "";
  const city = entity.city ? String(entity.city) : "";
  const state = entity.state ? String(entity.state).toUpperCase() : "";
  const postal = entity.postal_code ? String(entity.postal_code) : "";
  const cityState = [city, state].filter(Boolean).join(", ");
  const bits = [line1, cityState, postal].filter(Boolean);
  return bits.length ? bits.join(" ") : null;
}

function listedBusinesses(businesses = []) {
  return (businesses || []).map((biz) => {
    const entity = safeObject(biz && biz.entity_data) || {};
    const extra = String(entity.extra_owner_name || "").trim();
    const state = entity.state ? String(entity.state).toUpperCase() : null;
    const age = num(biz && biz.age_months);
    return {
      name: biz && biz.name ? String(biz.name) : null,
      state,
      ein: entity.ein ? String(entity.ein) : null,
      extra_owner_name: extra || null,
      address: formatBusinessAddress(entity),
      extra_owners_warning: !!extra,
      incorporated_date: entity.incorporated_date ? String(entity.incorporated_date) : null,
      age_months: age !== null && age >= 0 ? age : null
    };
  });
}

function companyKey(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/* businessScoreFromPulls — the Experian Business score a CRS pull stored for
   ONE saved company.

   WHERE THE SCORE ACTUALLY LANDS. A live pull orders one Experian Business
   report per saved company (src/finance/crs-pull.mjs orderSavedBusinessReports)
   and stores each raw body on crs_results.result.businessReports[] as
   { name, state, ageMonths, bin, report }. Nothing copies the score anywhere
   else, so a reader that only looks at businesses.entity_data never sees it.

   THE SAME TWO FIELDS THE ENGINE READS. deriveBusinessSignals()
   (vendor/underwriteiq-full/api/lite/crs/derive-business-signals.js) takes
   `report.data || report`, then scoreInformation.commercialScore.score as the
   Intelliscore and scoreInformation.fsrScore.score as the FSR. Read the same
   way here so the Credit tab and UnderwriteIQ agree on one number.

   The newest pull with a report for this company wins, even when that report
   has no score — an older number must not stand in for "no score yet".
   Sandbox pulls are a vendor's canned file, never this person's, and are
   skipped exactly as triMerge skips them. A sample report is flagged. */
export function businessScoreFromPulls(crsResults = [], business = null) {
  const empty = { found: false, intelliscore: null, fsr: null, asOf: null, sample: false };
  const wantName = companyKey(business && business.name);
  if (!wantName) return empty;
  const entity = safeObject(business && business.entity_data) || {};
  const wantState = companyKey(entity.state);
  for (const r of [...(crsResults || [])].sort(byNewest)) {
    const result = safeObject(r.result);
    if (!result) continue;
    if (String(result.environment || "").toLowerCase() === "sandbox") continue;
    const rows = Array.isArray(result.businessReports) ? result.businessReports : [];
    const row = rows.find((b) => {
      if (!b || companyKey(b.name) !== wantName) return false;
      const st = companyKey(b.state);
      return !wantState || !st || st === wantState;
    });
    if (!row) continue;
    const report = safeObject(row.report) || {};
    const data = safeObject(report.data) || report;
    const info = (data && data.scoreInformation) || {};
    return {
      found: true,
      intelliscore: firstScore100([info.commercialScore && info.commercialScore.score]),
      fsr: firstScore100([info.fsrScore && info.fsrScore.score]),
      asOf: r.created_at || result.pulledAt || null,
      sample: isSampleResult(result)
    };
  }
  return empty;
}

/* `crsResults` is optional. Passed, and a pull stored a report for the first
   business, that report is the answer — score or no score
   (businessScoreFromPulls). Omitted, the answer is what it has always been. The keys below are read only by older shapes — no writer in
   this repository fills them. */
export function businessCredit({ client = {}, businesses = [], crsResults = null } = {}) {
  const cf = client.custom_fields || {};
  const biz = businesses[0] || null;
  const entity = safeObject(biz && biz.entity_data) || {};
  const scores = safeObject(entity.scores) || {};
  const commercial = safeObject(entity.commercialScore) || {};
  const pulled = Array.isArray(crsResults) ? businessScoreFromPulls(crsResults, biz) : null;
  const fromPull = !!(pulled && pulled.found);
  return {
    name: biz && biz.name ? String(biz.name) : null,
    intelliscore: fromPull ? pulled.intelliscore : firstScore100([
      scores.intelliscore, entity.intelliscore, commercial.score,
      cf.biz_intelliscore, cf.intelliscore
    ]),
    fsr: fromPull ? pulled.fsr : firstScore100([scores.fsr, entity.fsr, cf.biz_fsr, cf.fsr]),
    businesses: listedBusinesses(businesses)
  };
}

export function latestBooking({ client = {}, tasks = [] } = {}) {
  const rows = [...(tasks || [])].filter((t) => {
    const src = String(t.source_workflow || "");
    const title = String(t.title || "");
    return src === "clickfunnels" || /booked|strategy session/i.test(title);
  }).sort((a, b) => new Date(b.due_at || b.created_at || 0) - new Date(a.due_at || a.created_at || 0));
  const t = rows[0] || null;
  const when = t && t.due_at ? t.due_at : null;
  const past = when ? new Date(when) < new Date() : false;
  const outcome = client.custom_fields && client.custom_fields.call_outcome
    ? String(client.custom_fields.call_outcome)
    : null;
  if (!t && !outcome) return { when: null, title: null, status: null };
  let status = null;
  if (outcome === "no_show") status = "no_show";
  else if (t && t.done) status = "done";
  else if (past) status = "past";
  else if (t) status = "upcoming";
  else if (outcome === "booked") status = "booked";
  return {
    when,
    title: t ? String(t.title || "Booked call") : null,
    status
  };
}

export function clientDetailExtras({ client, crsResults, tasks, fundingRounds, invoices, businesses } = {}) {
  return {
    tier_reasoning: tierReasoning(client, crsResults),
    tri_merge: triMerge(crsResults),
    utilisation: utilisation(crsResults, client),
    income_estimates: incomeEstimates(crsResults),
    business_credit: businessCredit({ client, businesses }),
    latest_booking: latestBooking({ client, tasks }),
    open_blockers: openBlockers({ client, tasks, fundingRounds, invoices, crsResults })
  };
}
