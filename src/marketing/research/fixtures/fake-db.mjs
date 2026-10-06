// A small in-memory stand-in for the tables the research jobs touch, for unit tests only.
// It answers exactly the statements src/marketing/research/* and the outbox/notify helpers
// send, by pattern, and fails loudly on anything else so a new statement is never silently
// ignored. The real SQL runs against Postgres in src/http/marketing-research.pg.test.mjs.

import { randomUUID } from "node:crypto";

export function fakeResearchDb({ settings = {} } = {}) {
  const jobs = new Map();
  const usage = [];
  const outbox = [];
  const buzzes = [];
  const seen = [];
  let outboxId = 0;

  const sumUsage = (rows) => rows.reduce((a, r) => {
    a.priced += r.cost_usd == null ? 0 : Number(r.cost_usd);
    a.searches += r.web_search_requests;
    a.fetches += r.web_fetch_requests;
    return a;
  }, { priced: 0, searches: 0, fetches: 0 });

  const db = {
    jobs, usage, outbox, buzzes, seen,
    addJob(row) {
      const id = row.id || randomUUID();
      const job = { id, org_id: row.org_id, kind: row.kind, payload: row.payload || {}, status: row.status || "queued", attempts: 0, result: row.result ?? null, error: null, run_after: new Date(), claimed_at: null, ...row, id };
      jobs.set(id, job);
      return job;
    },
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      seen.push(s.slice(0, 80));
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [] };

      if (/^UPDATE marketing_jobs SET result = \$2::jsonb WHERE id = \$1 AND status = 'running'$/.test(s)) {
        const j = jobs.get(params[0]);
        if (j && j.status === "running") { j.result = JSON.parse(params[1]); return { rows: [], rowCount: 1 }; }
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE marketing_jobs SET status = 'queued', claimed_at = NULL, result = \$2::jsonb, run_after = now\(\)/.test(s)) {
        const j = jobs.get(params[0]);
        if (j && j.status === "running") {
          Object.assign(j, { status: "queued", claimed_at: null, result: JSON.parse(params[1]), run_after_secs: params[2] });
          return { rows: [{ id: j.id }] };
        }
        return { rows: [] };
      }
      if (/^UPDATE marketing_jobs SET result = COALESCE\(result, '\{\}'::jsonb\) \|\| jsonb_build_object\('partial'/.test(s)) {
        const j = jobs.get(params[0]);
        if (j && j.status === "running") {
          const r = j.result || {};
          j.result = { ...r, partial: { ...(r.partial || {}), [params[1]]: JSON.parse(params[2]) } };
        }
        return { rows: [] };
      }
      if (/FROM marketing_model_usage WHERE job_id = \$1$/.test(s)) {
        const rows = usage.filter((u) => u.job_id === params[0]);
        const t = sumUsage(rows);
        return { rows: [{ priced_usd: t.priced, null_input: 0, null_output: 0, null_cache_read: 0, null_cache_write: 0, null_searches: 0, searches: t.searches, fetches: t.fetches, calls: rows.length }] };
      }
      if (/^INSERT INTO marketing_model_usage/.test(s)) {
        const [org_id, job_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, web_search_requests, web_fetch_requests, step] = params;
        const row = { id: randomUUID(), org_id, job_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, web_search_requests, web_fetch_requests, step, created_at: new Date() };
        usage.push(row);
        return { rows: [row] };
      }
      if (/^WITH bounds AS/.test(s)) {
        const rows = usage.filter((u) => u.org_id === params[0]);
        return { rows: [{ month_priced_usd: sumUsage(rows).priced, unpriced_rows: 0 }] };
      }
      if (/^SELECT max_month_cost_usd, research_shares_month_cap FROM marketing_settings WHERE org_id = \$1$/.test(s)) {
        return { rows: [{ max_month_cost_usd: 300, research_shares_month_cap: true, ...settings }] };
      }
      if (/^SELECT \* FROM marketing_settings WHERE org_id = \$1$/.test(s)) {
        return { rows: [{ org_id: params[0], max_batch_cost_usd: 40, max_month_cost_usd: 300, research_shares_month_cap: true, max_research_cost_usd: null, quiet_start: "21:00", quiet_end: "07:00", timezone: "America/Phoenix", ...settings }] };
      }
      if (/^INSERT INTO marketing_settings/.test(s)) return { rows: [] };
      if (/^INSERT INTO repo_outbox/.test(s)) {
        const [org_id, op_id, path, mode, content, edit] = params;
        if (outbox.some((o) => o.org_id === org_id && o.op_id === op_id)) return { rows: [] };
        const row = { id: ++outboxId, org_id, op_id, path, mode, content, edit, committed_sha: null };
        outbox.push(row);
        return { rows: [{ id: row.id, op_id, path, mode }] };
      }
      if (/^SELECT id, op_id, path, mode, content, edit FROM repo_outbox WHERE org_id = \$1 AND op_id = \$2$/.test(s)) {
        return { rows: outbox.filter((o) => o.org_id === params[0] && o.op_id === params[1]) };
      }
      if (/^SELECT content FROM repo_outbox/.test(s)) {
        const rows = outbox.filter((o) => o.path === params[0] && o.mode === "replace" && o.committed_sha == null);
        return { rows: rows.slice(-1).map((o) => ({ content: o.content })) };
      }
      if (/^INSERT INTO marketing_buzzes/.test(s)) {
        const [org_id, kind, body, group_key, send_after] = params;
        const prev = buzzes.find((b) => b.org_id === org_id && b.kind === kind && b.group_key === group_key);
        if (prev) { prev.body = body; return { rows: [{ ...prev, created: false }] }; }
        const row = { id: randomUUID(), org_id, kind, body, group_key, send_after };
        buzzes.push(row);
        return { rows: [{ ...row, created: true }] };
      }
      throw new Error(`fake research db: no answer for: ${s.slice(0, 160)}`);
    }
  };
  return db;
}

/**
 * Drive one job the way the worker does: claim (running), run the handler, and either
 * finish it, take the yield, or fail it. Returns the job row and how many claims it took.
 */
export async function driveJob(db, id, handler, ctx, { maxClaims = 60 } = {}) {
  let claims = 0;
  for (;;) {
    const job = db.jobs.get(id);
    if (job.status === "done" || job.status === "failed") return { job, claims };
    if (claims >= maxClaims) throw new Error(`job did not finish in ${maxClaims} claims (step ${job.result && job.result.step})`);
    claims += 1;
    job.status = "running";
    job.claimed_at = new Date();
    let out;
    try {
      out = await handler.run({ ...job }, ctx);
    } catch (err) {
      const j = db.jobs.get(id);
      j.attempts += 1;
      j.status = err && err.final ? "failed" : (j.attempts >= 3 ? "failed" : "queued");
      j.error = String(err && err.message);
      continue;
    }
    const j = db.jobs.get(id);
    if (j.status === "running") {
      j.status = "done";
      j.result = out;
    }
  }
}
