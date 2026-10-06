// /api/marketing/research — "Research it" (J20): start a deep research run, list the runs,
// read one run and its report.
//
// Route key "marketing/research" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §2 row J20, §3.2 item 5 and "Endpoints";
// contract docs/specs/marketing-machine-api.md §6.11. Unit X2. Table: marketing_jobs, kind
// 'deep_research' (migration 429: one in flight per company).
//
//   POST {question, depth:'quick'|'deep', sources:{web, vault, own_files}, belief?,
//         max_cost_usd, request_id}
//     → 202 {ok, started, already_running, job, poll}
//     → 400 {error:'bad_question', field, message}  no question, no place to look, no stop amount
//     → 400 {error:'invalid', field, message}       a malformed field
//     → 400 {error:'cap_reached', message}          the month cap is already used
//     → 503 {error:'no_model' | 'not_ready', message}
//   GET ?id=<uuid> → 200 {ok, job{…}, report{…}|null}   404 when not this company's run
//   GET            → 200 {ok, runs[] (20 newest), settings{…}, limits{quick, deep}}
//
//   A cost cap answers 400 {error:'cap_reached'} (the contract's rule: 409 is only 'stale';
//   design §3.2 wrote 409 cap_hit — recorded as a gap in docs/specs/marketing-machine-api.md §8).
//
// The run itself happens on the marketing worker in saved steps
// (src/marketing/research/deep-research.mjs); this route only queues it and wakes the
// worker. Nothing here touches the web, a page, an ad or a customer (design §5 rule 16).
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING) — requireAuth
// ignores roles (CLAUDE.md §12). The company is the session's, never one from the body.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  withRequest, staffRead, readBody, checkRequestId, sendKnownError, hasCompany
} from "../../src/marketing/http.mjs";
import { getOrCreateSettings } from "../../src/marketing/settings-store.mjs";
import { monthUsedUsd } from "../../src/marketing/research/usage.mjs";
import {
  checkResearchStart, startDeepResearch, researchJobView, researchReportView, repoStateOf,
  lastMeasured, researchLimits, monthState, monthCapSentence, hasModelKey, researchNotReady,
  BadQuestionError, NO_MODEL_SENTENCE, DEEP_KIND, Refusal
} from "../../src/marketing/research/store.mjs";
import { wakeWorker } from "../../src/marketing/wake.mjs";

export const ROUTE = "marketing/research";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read research or POST to start it." });
  }

  // The gate, in this file on purpose (scripts/journeys/extract.mjs reads it from here).
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    if (req.method === "GET") {
      const id = (req.query || {}).id;
      if (id != null && id !== "") {
        if (!UUID.test(String(id))) return res.status(400).json({ error: "invalid", field: "id", message: "id must be a research run's id." });
        const out = await staffRead(database, async (tx) => {
          const row = (await tx.query(
            `SELECT * FROM marketing_jobs WHERE id = $1 AND org_id = $2 AND kind = '${DEEP_KIND}'`,
            [String(id), orgId]
          )).rows[0];
          if (!row) return null;
          const repoPath = row.result && row.result.report ? row.result.report.repo_path : null;
          return { row, repo: await repoStateOf(tx, orgId, repoPath) };
        });
        if (!out) return res.status(404).json({ error: "not_found", message: "No research run with that id." });
        return res.status(200).json({ ok: true, job: researchJobView(out.row), report: researchReportView(out.row, { repo: out.repo }) });
      }
      const out = await staffRead(database, async (tx) => {
        const rows = (await tx.query(
          `SELECT * FROM marketing_jobs WHERE org_id = $1 AND kind = '${DEEP_KIND}' ORDER BY created_at DESC LIMIT 20`,
          [orgId]
        )).rows;
        const settings = await getOrCreateSettings(tx, orgId);
        const used = await monthUsedUsd(tx, orgId);
        const measured = await lastMeasured(tx, orgId);
        return { rows, settings, used, measured };
      });
      const m = monthState(out.settings, out.used);
      return res.status(200).json({
        ok: true,
        runs: out.rows.map(researchJobView),
        settings: {
          max_research_cost_usd: out.settings && out.settings.max_research_cost_usd != null ? Number(out.settings.max_research_cost_usd) : null,
          research_shares_month_cap: m.shares,
          month_used_usd: Math.round(m.month_used_usd * 100) / 100,
          month_cap_usd: m.month_cap_usd,
          measured: !!out.measured.quick,
          last_run: out.measured
        },
        limits: researchLimits()
      });
    }

    // POST — check what needs no database first.
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    if (!hasModelKey(env)) return res.status(503).json({ error: "no_model", message: NO_MODEL_SENTENCE });

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const settings = await getOrCreateSettings(tx, orgId);
      const input = checkResearchStart(body, settings);
      const m = monthState(settings, await monthUsedUsd(tx, orgId));
      if (m.capped) throw new Refusal(400, { error: "cap_reached", message: monthCapSentence(m.month_cap_usd) });
      const { job, already_running } = await startDeepResearch(tx, { orgId, staffId: staff.id ?? null, input });
      return {
        status: 202,
        body: { ok: true, queued: true, started: !already_running, already_running, job: researchJobView(job), poll: `marketing/research?id=${job.id}` }
      };
    });
    if (answer.status === 202 && answer.body.started) {
      // Wake the worker now; the clock wakes it anyway within 15 minutes if this misses.
      await (deps.wake ?? wakeWorker)(env).catch(() => null);
    }
    return res.status(answer.status).json(answer.body);
  } catch (err) {
    if (err instanceof Refusal) return res.status(err.status).json(err.body);
    if (err instanceof BadQuestionError) return res.status(400).json({ error: "bad_question", field: err.field, message: err.message });
    if (sendKnownError(res, err)) return;
    if (researchNotReady(err)) {
      return res.status(503).json({ error: "not_ready", message: "Research is built, but its database change is not live yet. It turns on with the next ship." });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
