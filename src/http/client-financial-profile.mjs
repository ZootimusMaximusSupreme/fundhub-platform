// Read-only, source-attributed facts for the existing Client Workspace.
// This never orders a report or treats an income-model code as verified wages.
import { offersIqSummaryForClient } from "../finance/offersiq.mjs";
import { evaluateLeadFitModels } from "../finance/lead-fit-models.mjs";
import { byNewest, isSampleResult, safeObject, triMerge } from "../pulse/beats/lib/lenders-credit.mjs";
import { questionById } from "../survey/cf-question-map.mjs";

const BUREAUS = [["TU", "transunion", "tu"], ["EQ", "equifax", "eq"], ["EX", "experian", "ex"]];
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = value => typeof value === "string" ? value.trim().slice(0, 160) : null;
const date = value => {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;

function realRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort(byNewest).flatMap(row => {
    const result = safeObject(row?.result);
    return result && !row.is_demo && !isSampleResult(result)
      && String(result.environment || "").toLowerCase() !== "sandbox" ? [{ ...row, result }] : [];
  });
}

function reportedAnswer(fields, id, setterKey) {
  const question = questionById(id);
  const edits = object(fields.setter_survey_edits);
  const handoff = object(fields.setter_handoff);
  const value = setterKey && handoff[setterKey] || edits[question.payloadKey] || fields[question.payloadKey];
  return question.options.includes(value) ? value : null;
}

function reportScores(rows) {
  const found = new Map();
  for (const row of rows) {
    const scores = triMerge([row]);
    const names = object(row.result.scoreModels || row.result.score_models);
    for (const [bureau, long, short] of BUREAUS) {
      if (found.has(bureau) || number(scores[long]) === null) continue;
      const raw = object(row.result.bureaus)[bureau];
      const matching = (Array.isArray(raw?.scores) ? raw.scores : []).find(value =>
        Number(value?.scoreValue) === scores[long] && /fico|fair\s*isaac/i.test(value?.modelName || ""));
      found.set(bureau, { bureau, score: scores[long],
        model: text(names[short] || names[long] || matching?.modelName),
        source: "CRS prequalification report", asOf: date(row.created_at || row.result.pulledAt) });
    }
  }
  return BUREAUS.map(([bureau]) => found.get(bureau)).filter(Boolean);
}

function tuIncomeModel(rows) {
  for (const row of rows) {
    const scores = object(row.result.bureaus).TU?.scores;
    const model = (Array.isArray(scores) ? scores : []).find(value =>
      /(?:creditvision.*income|income.*(?:insight|estimat))/i.test(value?.modelName || ""));
    if (!model) continue;
    const raw = typeof model.scoreValue === "number" ? String(model.scoreValue) : text(model.scoreValue);
    return { bureau: "TU", model: text(model.modelName),
      rawCode: raw && /^[\dA-Z .-]{1,20}$/i.test(raw) ? raw : null,
      annual: null, verified: false, status: "mapping_required",
      asOf: date(row.created_at || row.result.pulledAt) };
  }
  return null;
}

function incomeSource(rows, bureau, estimate, asOf) {
  const model = text(estimate?.model);
  const raw = number(estimate?.raw);
  if (!model || raw === null) return null;
  return rows.find(row => {
    if (date(row.created_at || row.result.pulledAt) !== date(asOf)) return false;
    const scores = object(row.result.bureaus)[bureau]?.scores;
    return (Array.isArray(scores) ? scores : []).some(score => {
      const value = score?.scoreValue;
      const observed = typeof value === "number" ? number(value)
        : typeof value === "string" && value.trim() ? number(Number(value)) : null;
      return text(score?.modelName) === model && observed === raw;
    });
  }) || null;
}

export function clientFinancialProfile({ client = {}, crsResults = [], incomeEstimates = {} } = {}) {
  const fields = object(client.custom_fields);
  const rows = realRows(crsResults);
  const creditScores = reportScores(rows);
  const offerMatch = offersIqSummaryForClient(client);
  const modelScores = [...creditScores];
  const scoredOffer = offerMatch && ["matched", "not_matched"].includes(offerMatch.outcome)
    && !offerMatch.stale && offerMatch.environment === "production";
  if (scoredOffer && Number.isInteger(offerMatch.credit_score)) {
    modelScores.push({ bureau: "EQ", score: offerMatch.credit_score, model: null,
      source: "CRS OffersIQ Equifax", asOf: date(offerMatch.checked_at) });
  }
  const incomeModels = [];
  // Reuse the two existing named-model adapters; never apply their unit rule to TU.
  for (const [key, bureau] of [["experian", "EX"], ["equifax", "EQ"]]) {
    const estimate = incomeEstimates[key];
    // A matching timestamp alone cannot establish provenance: a demo row can
    // share it with a real report, and missing dates can both be null.
    const source = incomeSource(rows, bureau, estimate, incomeEstimates.asOf);
    if (source && number(estimate?.annual) !== null && estimate.annual > 0) {
      incomeModels.push({ bureau, annual: estimate.annual, rawCode: String(estimate.raw ?? ""),
        model: text(estimate.model), verified: false, status: "model_estimate",
        asOf: date(source.created_at || source.result.pulledAt) });
    }
  }
  const tuIncome = tuIncomeModel(rows);
  if (tuIncome) incomeModels.push(tuIncome);
  const attributes = scoredOffer ? object(offerMatch.offers_iq_summary) : {};
  const bankruptcyCount = number(attributes.publicRecordBankruptcyCount);
  return {
    version: "2026-11-04", offerMatch, creditScores, incomeModels,
    reportedIncome: { range: reportedAnswer(fields, "annual_personal_income", "annual_personal_income"),
      verificationStated: reportedAnswer(fields, "verify_income", "income_verification"), basis: "client_stated" },
    reportedCapital: { range: reportedAnswer(fields, "available_capital"), basis: "client_stated" },
    verifiedIncome: null, property: null,
    fitModels: evaluateLeadFitModels({ creditScores: modelScores,
      bankruptcyCount: Number.isInteger(bankruptcyCount) && bankruptcyCount >= 0 ? bankruptcyCount : null,
      paidOffAutoCount: null, reportedAnnualIncome: null, verifiedAnnualIncome: null,
      liquidAssets: null, property: null })
  };
}
