// An in-memory stand-in for the two tables the offer endpoint touches —
// sessions (through verifySession) and marketing_jobs (through offer-store.mjs) —
// for the tests that run on a laptop with no Postgres.
//
// It answers ONLY the exact statements those two modules send, matched on a
// distinctive phrase, and throws on anything else, so a query this fake does not
// recognise fails the test instead of quietly returning nothing. It also enforces
// the migration's rules (409): a failed row needs a reason, a done row needs a
// result, and only one offer may be in flight per company. The real proof of
// those rules is src/http/marketing-offer-generate.pg.test.mjs against Postgres.

import { randomUUID } from "node:crypto";
import { hashToken } from "../../auth/session.mjs";

export function makeFakeDb({ staff = [], missingTable = false } = {}) {
  const sessions = new Map(); // token hash → staff row
  for (const s of staff) sessions.set(hashToken(s.token), s);
  const jobs = [];
  const log = [];
  let clock = Date.parse("2026-10-05T18:00:00Z");
  const now = () => new Date(clock += 1000);

  function checkRow(row) {
    if (row.status === "failed" && !(row.error && String(row.error).trim())) {
      const e = new Error('new row violates check constraint "marketing_jobs_failed_reason_ck"'); e.code = "23514"; throw e;
    }
    if (row.status === "done" && row.result == null) {
      const e = new Error('new row violates check constraint "marketing_jobs_done_result_ck"'); e.code = "23514"; throw e;
    }
  }
  const inFlight = (orgId) => jobs.filter((j) => j.org_id === orgId && j.kind === "offer" && ["queued", "running"].includes(j.status));
  const notReady = () => { const e = new Error('relation "marketing_jobs" does not exist'); e.code = "42P01"; return e; };
  const parse = (v) => (v == null ? null : JSON.parse(v));

  async function query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    log.push({ sql: s, params });

    if (s.includes("FROM live JOIN staff s")) {
      const row = sessions.get(params[0]);
      if (!row) return { rows: [] };
      return { rows: [{ session_id: randomUUID(), expires_at: new Date(Date.now() + 3600e3), staff_id: row.id,
        org_id: row.org_id, role: row.role, email: `${row.role}@example.test`, name: row.role, status: "active",
        avatar_key: null, active_flag: null }] };
    }

    if (!s.includes("marketing_jobs")) throw new Error(`fake db: unrecognised query: ${s.slice(0, 120)}`);
    if (missingTable) throw notReady();

    if (s.startsWith("UPDATE marketing_jobs SET status = 'failed', error = $2, finished_at = now() WHERE org_id = $1")) {
      return { rows: [] }; // stale sweep: the fake clock never ages a row 16 minutes
    }
    if (s.startsWith("INSERT INTO marketing_jobs")) {
      const [orgId, payload, requestedBy] = params;
      if (inFlight(orgId).length) return { rows: [] };
      const row = { id: randomUUID(), org_id: orgId, kind: "offer", payload: parse(payload), status: "queued",
        attempts: 0, run_after: now(), claimed_at: null, finished_at: null, error: null, result: null,
        requested_by: requestedBy, created_at: now(), updated_at: now() };
      jobs.push(row);
      return { rows: [{ ...row }] };
    }
    if (s.startsWith("SELECT * FROM marketing_jobs WHERE org_id = $1 AND kind = 'offer' AND status IN ('queued', 'running')")) {
      const r = inFlight(params[0]).sort((a, b) => b.created_at - a.created_at)[0];
      return { rows: r ? [{ ...r }] : [] };
    }
    if (s.includes("SET status = 'running', claimed_at = now()")) {
      const r = jobs.find((j) => j.id === params[0] && j.org_id === params[1] && j.status === "queued");
      if (!r) return { rows: [] };
      Object.assign(r, { status: "running", claimed_at: now(), attempts: r.attempts + 1 });
      return { rows: [{ ...r }] };
    }
    if (s.includes("SET status = 'done', result = $3::jsonb")) {
      const r = jobs.find((j) => j.id === params[0] && j.org_id === params[1] && j.status === "running");
      if (!r) return { rows: [] };
      const next = { ...r, status: "done", result: parse(params[2]), error: null, finished_at: now() };
      checkRow(next);
      Object.assign(r, next);
      return { rows: [{ id: r.id }] };
    }
    if (s.includes("SET status = 'failed', error = $3, result = $4::jsonb")) {
      const r = jobs.find((j) => j.id === params[0] && j.org_id === params[1] && ["queued", "running"].includes(j.status));
      if (!r) return { rows: [] };
      const next = { ...r, status: "failed", error: params[2], result: parse(params[3]), finished_at: now() };
      checkRow(next);
      Object.assign(r, next);
      return { rows: [{ id: r.id }] };
    }
    if (s.startsWith("SELECT * FROM marketing_jobs WHERE id = $1 AND org_id = $2")) {
      const r = jobs.find((j) => j.id === params[0] && j.org_id === params[1] && j.kind === "offer");
      return { rows: r ? [{ ...r }] : [] };
    }
    if (s.includes("AND status = 'done' ORDER BY finished_at DESC")) {
      const r = jobs.filter((j) => j.org_id === params[0] && j.status === "done").sort((a, b) => b.finished_at - a.finished_at)[0];
      return { rows: r ? [{ ...r }] : [] };
    }
    if (s.startsWith("SELECT * FROM marketing_jobs WHERE org_id = $1 AND kind = 'offer' ORDER BY created_at DESC LIMIT 1")) {
      const r = jobs.filter((j) => j.org_id === params[0]).sort((a, b) => b.created_at - a.created_at)[0];
      return { rows: r ? [{ ...r }] : [] };
    }
    throw new Error(`fake db: unrecognised marketing_jobs query: ${s.slice(0, 160)}`);
  }

  return { query, jobs, log };
}
