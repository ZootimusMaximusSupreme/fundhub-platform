// Hourly adapters over the same read-only SQL and verdicts used by the daily money lanes.

import {
  CHECK_IDS as FUNDING_IDS, SAMPLE_ROWS_SQL, runMoneyFundingChecks
} from "./money-funding-truth.mjs";
import {
  CHECK_IDS as CHECKOUT_IDS, FUNNEL_PRESSES_SQL, PAID_SERVICE_SQL, readCheckoutTruth
} from "./money-checkout-truth.mjs";
import {
  CHECK_IDS as SETUP_IDS, PAID_TURNS_ON_SQL, readFinanceSetupTruth
} from "./money-finance-setup-truth.mjs";
import {
  CHECK_IDS as UNMATCHED_IDS, LATE_NO_FLAG_SQL, RECEIPT_WAITING_SQL, readUnmatchedTruth
} from "./money-unmatched-truth.mjs";
import {
  ADDON_PAID_NO_PLAN_SQL, CHECK_IDS as SUBSCRIPTION_IDS, readSubscriptionsTruth
} from "./money-subscriptions-truth.mjs";
import {
  CHECK_IDS as MOVE_IDS, STUCK_SQL as MOVE_STUCK_SQL, readMoneyMovesTruth
} from "./money-moves-truth.mjs";
import {
  CHECK_IDS as ADS_IDS, LOAD_JOBS_SQL, readAdsMetaTruth
} from "./money-ads-meta-truth.mjs";
import {
  CHECK_IDS as FUNDING_TRIP_IDS, TRIP_SQL as FUNDING_TRIP_SQL,
  judgeFunding, tripParams as fundingTripParams
} from "./trip-funding-truth.mjs";
import {
  AFFILIATE_SQL, CHECK_IDS as PARTNER_TRIP_IDS, PAGE_CAP, PARTNER_SQL, ROW_CAP,
  judgePartner, pickPages, readPage, tripParams as partnerTripParams
} from "./trip-partner-truth.mjs";
import { clip, row } from "./money-truth-utils.mjs";

export const DEFAULT_ORG_SQL = "SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1";
export const SELF_TEST_NOW = new Date("2026-10-09T19:07:00.000Z");
export const SELF_TEST_ORG = "00000000-0000-4000-8000-000000000001";

const stepName = (id) => String(id).replaceAll(":", "-");
const checks = (ids) => Object.freeze(ids.map((id) => Object.freeze({ id, step: stepName(id) })));
const descriptor = (ids, run, selfTest = {}) => Object.freeze({
  checks: checks(ids),
  run,
  selfTest: Object.freeze(selfTest)
});

const fundingTripFail = Object.freeze({
  client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  client_code: "FH-000101",
  diagnostic_paid_at: "2026-10-09T15:07:00.000Z",
  deposit_paid_at: null,
  sales_card_at: null,
  sales_stage: null,
  booked_at: null,
  call_held_at: null,
  last_outcome: null,
  funding_card_at: null,
  funding_stage: null,
  round_id: null,
  round_number: null,
  round_status: null,
  round_opened_at: null,
  funded_at: null,
  card_stacking: null,
  has_closeout: false,
  bills: 0,
  linked_sales: 0,
  back_end_staff: 0,
  commission_rows: 0,
  confirmed_approvals: 0,
  excluded_approvals: 0,
  fee_percent: null,
  approved_at: null,
  submitted_at: null
});

const partnerTripFail = Object.freeze({
  payee_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  name: "Pat Referrer",
  tracking_id: null,
  status: "active",
  applied_at: "2026-09-19T19:07:00.000Z",
  activated_at: null,
  license_ok: false,
  tax_ok: false,
  credited_n: 0,
  first_click_at: null,
  uncredited_n: 0,
  converted_n: 0,
  converted_at: null,
  rated_n: 0,
  unrated_n: 0,
  unconverted_paid_n: 0,
  payable_usd: 0,
  paid_n: 0,
  paid_at: null,
  held_n: 0,
  stuck_n: 0
});

const catalogue = Object.freeze({
  ok: true,
  checkout: Object.freeze({ ready: true }),
  items: Object.freeze([
    Object.freeze({ slug: "autopsy", priceCents: 100, available: true }),
    Object.freeze({ slug: "board", priceCents: 100, available: true }),
    Object.freeze({ slug: "trial", priceCents: 100, available: true })
  ])
});

const goodTill = Object.freeze({
  "GET https://fundhub.ai/api/public/funnel-checkout": Object.freeze({ status: 200, body: JSON.stringify(catalogue) })
});

async function readFundingTrip(io) {
  try {
    const out = await io.read(FUNDING_TRIP_SQL, fundingTripParams(io.orgId, io.now));
    return [judgeFunding({ rows: out.rows || [], now: io.now })];
  } catch (err) {
    return [row(FUNDING_TRIP_IDS[0], "skip", `could not read the funding trips: ${clip(err)}`)];
  }
}

async function readPartnerPages(io, partners) {
  const pages = new Map();
  const rows = partners.filter((value) => value.page_slug && value.status === "active");
  if (!rows.length || typeof io.readWeb !== "function") return pages;
  const picked = pickPages(rows.map((value) => ({ partner_id: value.payee_id, slug: value.page_slug })), io.now, PAGE_CAP);
  const web = async (url, init = {}) => {
    const answer = await io.readWeb(String(init.method || "GET"), url, init);
    return { status: answer.status, text: async () => answer.text };
  };
  const origin = String(io.baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  const results = await Promise.all(picked.map(async (value) => [value.partner_id, await readPage(web, origin, value)]));
  for (const [id, result] of results) pages.set(String(id), result);
  return pages;
}

async function readPartnerTrip(io) {
  try {
    const params = partnerTripParams(io.orgId, io.now);
    const affiliates = await io.read(AFFILIATE_SQL, params.affiliate);
    const partners = await io.read(PARTNER_SQL, params.partner);
    const partnerRows = partners.rows || [];
    const pages = await readPartnerPages(io, partnerRows);
    let note = "";
    if (partnerRows.some((value) => value.page_slug && value.status === "active") && typeof io.readWeb !== "function") {
      note = "The published pages were not opened in this run, so live was not judged.";
    }
    if ((affiliates.rows || []).length >= ROW_CAP || partnerRows.length >= ROW_CAP) {
      note = `${note} Only the first ${ROW_CAP} of one list were read.`.trim();
    }
    return [judgePartner({ affiliates: affiliates.rows || [], partners: partnerRows, pages, now: io.now, note })];
  } catch (err) {
    return [row(PARTNER_TRIP_IDS[0], "skip", `could not read the partner trips: ${clip(err)}`)];
  }
}

const runOperations = async (io) => (await Promise.all([
  readFinanceSetupTruth(io),
  readUnmatchedTruth(io),
  readSubscriptionsTruth(io),
  readMoneyMovesTruth(io),
  readAdsMetaTruth(io)
])).flat();

export const FUNDING_TRIP_LANE = descriptor(FUNDING_TRIP_IDS, readFundingTrip, {
  failRows: [[FUNDING_TRIP_SQL, [fundingTripFail]]]
});

export const PARTNER_TRIP_LANE = descriptor(PARTNER_TRIP_IDS, readPartnerTrip, {
  failRows: [[AFFILIATE_SQL, [partnerTripFail]], [PARTNER_SQL, []]]
});

export const MONEY_FUNDING_LANES = descriptor(FUNDING_IDS, runMoneyFundingChecks, {
  failRows: [[SAMPLE_ROWS_SQL, [{ clients: 1 }]]]
});

export const MONEY_CHECKOUT_LANES = descriptor(CHECKOUT_IDS, readCheckoutTruth, {
  passRows: [
    [PAID_SERVICE_SQL, [{}]],
    [FUNNEL_PRESSES_SQL, [{ item: "autopsy", presses_n: 3, paid_n: 1 }]]
  ],
  passHttp: goodTill,
  failRows: [[FUNNEL_PRESSES_SQL, [{ item: "autopsy", presses_n: 3, paid_n: 0 }]]]
});

export const MONEY_OPERATIONS_LANES = descriptor(
  [...SETUP_IDS, ...UNMATCHED_IDS, ...SUBSCRIPTION_IDS, ...MOVE_IDS, ...ADS_IDS],
  runOperations,
  {
    passRows: [
      [PAID_TURNS_ON_SQL, [{}]],
      [RECEIPT_WAITING_SQL, [{}]],
      [LATE_NO_FLAG_SQL, [{}]],
      [ADDON_PAID_NO_PLAN_SQL, [{}]],
      [MOVE_STUCK_SQL, [{ judged_n: 1, live_n: 1, unsent_n: 0, unsettled_n: 0, task_open_n: 0 }]],
      [LOAD_JOBS_SQL, [{}]]
    ],
    passEnv: { FINANCE_OS_SETUP_FEE_CENTS: "10000" },
    failRows: [[LOAD_JOBS_SQL, [{ total_n: 1, failed_n: 1 }]]]
  }
);

const compactSql = (text) => String(text).trim().replaceAll(/\s+/g, " ");

export function fakeLaneRead(overrides = []) {
  const answers = overrides.map(([sql, rows]) => [compactSql(sql), rows]);
  return async (sql) => {
    const query = compactSql(sql);
    if (query === compactSql(DEFAULT_ORG_SQL)) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
    const found = answers.find(([wanted]) => wanted === query);
    const rows = found ? found[1] : [];
    return { rows, rowCount: rows.length };
  };
}

export function laneSelfTest(lane, fail = false) {
  const spec = lane.selfTest || {};
  const rows = fail
    ? [...(spec.failRows || []), ...(spec.passRows || [])]
    : (spec.passRows || []);
  return {
    now: new Date(SELF_TEST_NOW.getTime()),
    read: fakeLaneRead(rows),
    env: fail ? (spec.failEnv || spec.passEnv || {}) : (spec.passEnv || {}),
    http: fail ? (spec.failHttp || spec.passHttp || {}) : (spec.passHttp || {})
  };
}

async function defaultOrg(ctx) {
  const out = await ctx.read(DEFAULT_ORG_SQL);
  return out.rows?.[0]?.id || null;
}

function webReader(ctx) {
  return async (method, url, init = {}) => {
    const verb = String(method || "GET").toUpperCase();
    if (verb !== "GET" && verb !== "HEAD") throw new Error(`money beat only reads with GET or HEAD (got ${verb})`);
    const response = verb === "HEAD"
      ? await ctx.http.head(url, { headers: init.headers })
      : await ctx.http.get(url, { headers: init.headers });
    return { status: Number(response?.status || 0), text: String(response?.body ?? response?.bodySnippet ?? "") };
  };
}

export async function runLaneBeat(ctx, lane) {
  let results = [];
  await ctx.step("read", async () => {
    const orgId = await defaultOrg(ctx);
    if (!orgId) throw ctx.fail("read", "the default company could not be read, so the money checks did not run");
    results = await lane.run(Object.freeze({
      read: (sql, params) => ctx.read(sql, params),
      readWeb: webReader(ctx),
      hasScope: true,
      orgId,
      now: new Date(ctx.now.getTime()),
      env: ctx.env,
      baseUrl: ctx.siteUrl
    }));
    const got = new Set(results.map((result) => result?.id));
    const missing = lane.checks.filter((check) => !got.has(check.id)).map((check) => check.id);
    if (missing.length) throw ctx.fail("read", `the money truth returned no result for ${missing.join(", ")}`);
  });

  let passed = 0;
  let skipped = 0;
  for (const check of lane.checks) {
    const result = results.find((candidate) => candidate?.id === check.id);
    const status = String(result?.status || "").toUpperCase();
    const detail = String(result?.detail || "the check returned no detail");
    if (status === "PASS") {
      await ctx.step(check.step, async () => { passed += 1; });
    } else if (status === "FAIL") {
      await ctx.step(check.step, async () => { throw ctx.fail(check.step, detail); });
    } else if (status === "SKIP" || status === "NA" || status === "NOT_CHECKED") {
      skipped += 1;
      ctx.skipStep(check.step, detail);
    } else {
      await ctx.step(check.step, async () => {
        throw ctx.fail(check.step, `${check.id} returned the unknown status ${status || "empty"}: ${detail}`);
      });
    }
  }
  return ctx.done(`${passed} money checks passed${skipped ? `; ${skipped} had nothing safe to judge` : ""}`);
}
