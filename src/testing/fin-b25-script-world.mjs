// A small in-memory ad_scripts / repo_outbox / marketing_shoots world for the batch 25 practice tests.
// It answers the statements src/marketing/scripts-store.mjs, shoot-store.mjs and the script routes really
// send, by the conditions the SQL text names (rowsWhere reads the WHERE clause). Fake data only.
import { plainSql, rowsWhere } from "./s3-scoped-rows.mjs";
import { insertedRow, requestLog, updatedFields } from "./fin-b25-kit.mjs";

const NOW = new Date("2026-10-14T18:00:00.000Z");

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let quote = false;
  let current = "";
  for (const char of text) {
    if (char === "'") quote = !quote;
    if (!quote) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        out.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** One ad_scripts row with every column the store reads. */
export function scriptRow(over = {}) {
  return {
    id: "a5000000-0000-4000-8000-000000000001",
    org_id: "0a000000-0000-4000-8000-000000000001",
    partner_id: null,
    root_script_id: "a5000000-0000-4000-8000-0000000000f0",
    parent_script_id: null,
    version: 1,
    status: "draft",
    ad_id: null,
    title: "Say the cause first",
    body: "Your inquiries are why the bank said no.\n\nHere is the fix.",
    hook_text: null,
    parts: null,
    script_type: "ad",
    script_format: "standard",
    style: "bullets",
    funnel_key: "book_call",
    angle_key: "cause",
    hook_key: null,
    offer_key: "funding_dfy",
    lane: "funding600",
    batch_id: null,
    idea_id: null,
    source: "machine",
    check_results: null,
    fix_note: null,
    animation_plan: null,
    meta_copy: null,
    film_order: null,
    needs_retake: false,
    locked_at: null,
    locked_by: null,
    rejected_at: null,
    rejected_by: null,
    rejected_reason: null,
    filmed_at: null,
    repo_path: null,
    repo_commit: null,
    archived_at: null,
    created_at: new Date("2026-10-11T10:00:00.000Z"),
    updated_at: new Date("2026-10-11T10:00:00.000Z"),
    stack_kind: null,
    stack_no: null,
    angle_name: null,
    ...over,
  };
}

/**
 * scriptWorld({ scripts, batches, shoots, nextAdNumber }) builds the rules and the tables to read back.
 * Tables are live arrays: read them after a call to see what changed.
 */
export function scriptWorld({ scripts = [], batches = [], shoots = [], videos = [], nextAdNumber = 91 } = {}) {
  const log = requestLog();
  const world = {
    scripts, batches, shoots, videos, outbox: [], voicePairs: [], jobs: [], adNumberAsks: [], statements: [], nextAdNumber,
    requests: log,
  };
  let outboxId = 0;
  const batchOf = (row) => batches.find((b) => b.id === row.batch_id) || null;
  const visible = (row) => {
    if (row.source === "import") return false;
    if (!row.batch_id) return true;
    const b = batchOf(row);
    return !!b && b.status === "released" && new Date(b.release_at) <= NOW;
  };
  const withBatch = (row) => ({ ...row, batch_week_key: batchOf(row)?.week_key ?? null });
  const live = (row) => row.archived_at == null;

  world.rules = [
    ...log.rules,
    [/pg_advisory_xact_lock/, []],
    // lockLiveScript: the version a write names, with whether a screen may see it.
    [/AS visible\s+FROM ad_scripts s/, (sql, params) =>
      rowsWhere(scripts, sql, params).map((row) => ({ ...withBatch(row), visible: visible(row) }))],
    // readRow after a write.
    [/^\s*SELECT\s+s\.id, s\.org_id[\s\S]*FROM ad_scripts s LEFT JOIN marketing_batches b ON b\.id = s\.batch_id\s+WHERE s\.id = \$1\s*$/, (sql, params) =>
      rowsWhere(scripts, sql, params).map(withBatch)],
    // the live version a 409 hands back, and the fix route's live version read
    [/^\s*SELECT version, body, parts FROM ad_scripts\s+WHERE root_script_id = \$1 AND org_id = \$2 AND archived_at IS NULL/, (sql, params) =>
      rowsWhere(scripts, sql, params)],
    [/^\s*SELECT id, version, body, parts FROM ad_scripts\s+WHERE root_script_id = \$1 AND org_id = \$2 AND archived_at IS NULL/, (sql, params) =>
      rowsWhere(scripts, sql, params)],
    [/^\s*SELECT id, root_script_id, version, archived_at FROM ad_scripts WHERE id = \$1 AND org_id = \$2/, (sql, params) =>
      rowsWhere(scripts, sql, params)],
    [/^\s*SELECT body, parts FROM ad_scripts\s+WHERE root_script_id = \$1 AND org_id = \$2 AND source = 'machine'/, (sql, params) =>
      rowsWhere(scripts, sql, params).sort((a, b) => b.version - a.version).slice(0, 1)],
    [/^\s*SELECT next_ad_number\(\$1\) AS n/, (_sql, params) => {
      world.adNumberAsks.push(params[0]);
      const n = world.nextAdNumber;
      world.nextAdNumber += 1;
      return [{ n }];
    }],
    [/^\s*SELECT created_at FROM ad_scripts WHERE id = \$1/, (sql, params) => rowsWhere(scripts, sql, params)],
    [/^\s*SELECT count\(\*\)::int AS n FROM ad_scripts/, [{ n: 1 }]],
    [/^\s*SELECT 1 FROM ad_scripts WHERE repo_path = \$1 AND root_script_id <> \$2/, (_sql, params) =>
      scripts.filter((s) => s.repo_path === params[0] && s.root_script_id !== params[1]).map(() => ({ "?column?": 1 }))],
    [/^\s*UPDATE ad_scripts SET repo_path = \$1 WHERE id = \$2/, (sql, params) => {
      const hit = scripts.find((s) => s.id === params[1]);
      if (hit) hit.repo_path = params[0];
      return { rows: [], rowCount: hit ? 1 : 0 };
    }],
    // approve
    [/^\s*UPDATE ad_scripts\s+SET status = 'locked'/, (sql, params) => {
      const hit = rowsWhere(scripts, sql, params);
      for (const row of hit) Object.assign(row, updatedFields(sql, params, NOW), { status: "locked" });
      return { rows: hit, rowCount: hit.length };
    }],
    // edit: archive the old version, copy it forward
    [/^\s*UPDATE ad_scripts SET archived_at = now\(\), status = 'superseded'/, (sql, params) => {
      const hit = rowsWhere(scripts, sql, params);
      for (const row of hit) Object.assign(row, { archived_at: NOW, status: "superseded" });
      return { rows: hit, rowCount: hit.length };
    }],
    [/^\s*INSERT INTO ad_scripts\s+\(org_id, partner_id, parent_script_id/, (sql, params) => {
      // INSERT INTO ad_scripts (a, b, ...) SELECT x, y, ... FROM ad_scripts WHERE id = $1: read both lists
      // from the statement, so a changed column, literal or "version + 1" changes the row written here.
      const text = plainSql(sql);
      const match = /INSERT INTO ad_scripts \(([^)]*)\) SELECT (.*?) FROM ad_scripts WHERE id = \$1 RETURNING id/i.exec(text);
      if (!match) throw new Error(`world cannot read the insert: ${text.slice(0, 100)}`);
      const columns = match[1].split(",").map((c) => c.trim());
      const items = splitTopLevel(match[2]);
      const from = scripts.find((row) => row.id === params[0]);
      const next = {};
      columns.forEach((column, index) => {
        const item = items[index];
        let value;
        const bound = /^\$(\d+)(?:::\w+)?$/.exec(item);
        const literal = /^'([^']*)'$/.exec(item);
        if (item === "version + 1") value = Number(from.version) + 1;
        else if (bound) value = params[Number(bound[1]) - 1];
        else if (literal) value = literal[1];
        else value = from[item];
        if (bound && /::jsonb$/.test(item) && typeof value === "string") value = JSON.parse(value);
        next[column] = value;
      });
      Object.assign(next, {
        id: `a5000000-0000-4000-8000-0000000001${String(scripts.length).padStart(2, "0")}`,
        archived_at: null, created_at: NOW, updated_at: NOW,
        rejected_at: null, rejected_by: null, rejected_reason: null, filmed_at: null, repo_commit: null,
      });
      world.insertedScript = { sql, params, row: next };
      scripts.push(next);
      return [{ id: next.id }];
    }],
    [/^\s*INSERT INTO voice_pairs/, (sql, params) => {
      world.voicePairs.push({ org_id: params[0], script_id: params[1], pairs: JSON.parse(params[2]) });
      return [];
    }],
    // reject
    [/^\s*UPDATE ad_scripts\s+SET status = 'rejected'/, (sql, params) => {
      const hit = rowsWhere(scripts, sql, params);
      for (const row of hit) Object.assign(row, { status: "rejected", rejected_at: NOW, rejected_by: params[1], rejected_reason: params[2] });
      return { rows: hit, rowCount: hit.length };
    }],
    // film order
    [/^\s*SELECT s\.root_script_id FROM ad_scripts s LEFT JOIN marketing_batches b/, (_sql, params) =>
      scripts.filter((s) => s.org_id === params[0] && params[1].includes(s.root_script_id) && live(s) && visible(s))
        .map((s) => ({ root_script_id: s.root_script_id }))],
    [/^\s*UPDATE ad_scripts s SET film_order = o\.n/, (_sql, params) => {
      world.orderWrite = { org: params[0], order: params[1] };
      for (const row of scripts) {
        const at = params[1].indexOf(row.root_script_id);
        if (row.org_id === params[0] && at >= 0 && live(row)) row.film_order = at + 1;
      }
      return [];
    }],
    // the repo outbox
    [/^\s*INSERT INTO repo_outbox/, (sql, params) => {
      const dup = world.outbox.find((r) => r.org_id === params[0] && r.op_id === params[1]);
      if (dup) return [];
      const row = {
        id: (outboxId += 1), org_id: params[0], op_id: params[1], path: params[2], mode: params[3],
        content: params[4], edit: params[5] == null ? null : JSON.parse(params[5]),
      };
      world.outbox.push(row);
      return [{ id: row.id, op_id: row.op_id, path: row.path, mode: row.mode }];
    }],
    // the queue
    [/^\s*INSERT INTO marketing_jobs/, (sql, params) => {
      const job = { id: `10000000-0000-4000-8000-0000000000${String(world.jobs.length + 1).padStart(2, "0")}`, org_id: params[0], kind: params[1], payload: JSON.parse(params[2]), status: "queued" };
      world.jobs.push(job);
      return [job];
    }],
  ];
  world.insertedRow = insertedRow;
  return world;
}

export { NOW as WORLD_NOW };
