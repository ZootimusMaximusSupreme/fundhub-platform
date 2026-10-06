// The script writer's save (spec §7.6 "Saving", §4 trap 3), against real Postgres.
//
// WHAT THIS PROVES
//   * writeSlot saves the draft the way the spec says: status draft, source machine,
//     version 1, root_script_id = its own id, the slot's funnel, format, style and
//     batch, parts / animation_plan / meta_copy / check_results as JSON.
//   * The row and its ad_labels are visible to the house partner under partner row
//     security, and not to another partner. When APP_DATABASE_URL is set (CI) the
//     writer itself connects as the unprivileged fundhub_app role, so a write made
//     outside asStaff() would have been refused: the save really is inside asStaff().
//   * NO TRANSACTION IS OPEN DURING A MODEL CALL: the pool is wrapped, every BEGIN /
//     COMMIT / ROLLBACK is counted, and the fake Anthropic checks the count is 0 at
//     every call (and that transactions did run, so the check is not empty).
//   * No repo_outbox row is written for a draft (draft files are committed at
//     release, U35).
//   * Every model call is in marketing_model_usage with the model that served it.
//   * fixScript on a locked script: one transaction archives the old version and
//     inserts the new one with the same root and the same ad number, still locked,
//     with Chris's note in fix_note.
//   * The ideas inbox under migration 414's checks: a slot written from an idea sets it
//     'written' with its script and batch; a refusal sets it 'failed' with a reason and
//     one attempt; a setup fault (a masked key) leaves it exactly as it was.
//
// Nothing here reaches the network: Anthropic is a fake fetch, and GITHUB_REPO_TOKEN is
// not in the env, so the rule files come from the repo copies.
//
// Every row lives in this file's own org (slug below); after() deletes them.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { rlsPool, rlsIsReal, closeRlsPool } from "../testing/rls-pool.mjs";
import { asPartner as _asPartner } from "../partners/rls.mjs";
import { writeSlot, fixScript } from "../marketing/writer.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "zz-u24-writer-test";
const OTHER_SLUG = "zz-u24-other-partner";
const ENV = Object.freeze({ OPENAI_API_KEY: "sk-openai-test-not-real", ANTHROPIC_API_KEY: "sk-ant-test-not-real" });

const asPartner = (partnerId, fn) => _asPartner(partnerId, fn, { pool: rlsPool });

// ── A draft that passes every code check (standard, bullets) ─────────────────────────

const HOOK = "Lenders read two files before they say yes, and you have probably only fixed one of them.";
const LINE2 = "Which one they read FIRST sets how much funding you can get.";
const CUES = [
  "Your personal file shows every card balance",
  "Your business file shows how long the company has been open",
  "On bigger lines the business file gets read first"
];
const REVEAL = "So fix the file they read first, and the rest gets easier ↑";
const CTA = "Tap below to get your Roadmap. It is a soft pull only, so there is zero impact on your score, and nothing moves until you say so.";

function draft(cta = CTA, hook = HOOK, hookKey = "lenders_read_two_files_u24") {
  return {
    title: "The Conveyor Belt",
    angle_key: "the_conveyor_belt",
    hook_key: hookKey,
    offer_key: "slo_roadmap",
    lane: "uwiq",
    script_format: "standard",
    style: "bullets",
    body: [hook, "", LINE2, "", ...CUES.map((c) => `- ${c}`), "", REVEAL, "", cta].join("\n"),
    parts: [
      { kind: "hook", text: hook }, { kind: "line2", text: LINE2 },
      ...CUES.map((t) => ({ kind: "cue", text: t })),
      { kind: "reveal", text: REVEAL }, { kind: "cta", text: cta }
    ],
    meta_copy: { primary_text: "Lenders read two files before they say yes. See both of yours first.", headline: "See both files first", description: "Your Funding Roadmap", cta_type: "LEARN_MORE" },
    animation_plan: [
      { anchor: { phrase: null, cue: 1, keyword: "personal" }, template: "FileItems", props: "{}", seconds: 2.5 },
      { anchor: { phrase: null, cue: 3, keyword: "first" }, template: "StepPath", props: "{}", seconds: 3 }
    ]
  };
}

// ── A pool that counts open transactions ──────────────────────────────────────────────

const tx = { open: 0, begun: 0 };

function trackingPool(base) {
  return {
    async connect() {
      const client = await base.connect();
      let inTx = false;
      const end = () => { if (inTx) { inTx = false; tx.open--; } };
      return {
        async query(sql, params) {
          const s = String(sql).trim().toUpperCase();
          if (s.startsWith("BEGIN") && !inTx) { inTx = true; tx.open++; tx.begun++; }
          try {
            return await client.query(sql, params);
          } finally {
            if (s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) end();
          }
        },
        release(...args) { end(); return client.release(...args); }
      };
    },
    query: (sql, params) => base.query(sql, params)
  };
}

/** Fake Anthropic: answers the writer with `replies` in order and the judge with none.
 *  A reply {refusal: "<category>"} is a refusal with that category. */
function fakeAnthropic(replies) {
  const calls = [];
  let w = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const isJudge = !!body.output_config?.format?.schema?.properties?.violations;
    calls.push({ url: String(url), openTx: tx.open, kind: isJudge ? "judge" : "writer" });
    const out = isJudge ? { violations: [] } : replies[Math.min(w++, replies.length - 1)];
    const refused = out && typeof out.refusal === "string";
    return {
      ok: true, status: 200,
      json: async () => ({
        id: "msg_pg", type: "message", role: "assistant", model: body.model,
        content: refused ? [] : [{ type: "text", text: JSON.stringify(out) }],
        stop_reason: refused ? "refusal" : "end_turn",
        stop_details: refused ? { type: "refusal", category: out.refusal, explanation: "test" } : null,
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 8000 }
      })
    };
  };
  return { fetchImpl, calls };
}

describe("the script writer's save (U24)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, house, other, batch;
  let pool;
  /** Three ideas from Chris: one to write, one Claude refuses, one hit by a setup fault. */
  const ideas = { write: null, refuse: null, setup: null };

  /* Scripts go before ideas: ad_scripts.idea_id is ON DELETE RESTRICT (414), while
     ad_ideas.script_id is SET NULL. */
  async function purge() {
    await db.query(`DELETE FROM marketing_model_usage WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM marketing_buzzes WHERE org_id = $1`, [org]);
    for (let i = 0; i < 20; i++) {
      const gone = await db.query(
        `DELETE FROM ad_scripts s
          WHERE s.org_id = $1
            AND NOT EXISTS (SELECT 1 FROM ad_scripts k
                             WHERE k.id <> s.id
                               AND (k.parent_script_id = s.id OR k.root_script_id = s.id))`,
        [org]
      );
      if (!gone.rowCount) break;
    }
    await db.query(`DELETE FROM ad_ideas WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM ad_labels WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM marketing_batches WHERE org_id = $1`, [org]);
  }

  before(async () => {
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'U24 writer test')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG])).rows[0].id;
    const partner = async (slug, name) => (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [org, name, slug])).rows[0].id;
    house = await partner("fundhub-house", "Fundhub (house)");
    other = await partner(OTHER_SLUG, "U24 other partner");
    await purge();
    await db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, offer_key, lane, book_call, format_mix)
       VALUES ($1, 'roadmap_147', 'Roadmap', 'https://apply.fundhub.ai/roadmap', 'slo_roadmap', 'uwiq', false, '{"standard":1}'::jsonb)
       ON CONFLICT (org_id, key) DO NOTHING`, [org]);
    batch = (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, status, total, release_at)
       VALUES ($1, 'on_command', 'writing', 3, now()) RETURNING id, org_id, kind, status, rules_sha, total`, [org])).rows[0];
    for (const k of Object.keys(ideas)) {
      ideas[k] = (await db.query(
        `INSERT INTO ad_ideas (org_id, source, kind, raw_points, status)
         VALUES ($1, 'chris', 'script', $2, 'new') RETURNING id`,
        [org, `U24 pg idea (${k}): most people fix the file the lender never reads first.`])).rows[0].id;
    }
    pool = trackingPool(rlsPool());
  });

  after(async () => {
    try {
      await purge();
      await db.query(`DELETE FROM marketing_funnels WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM marketing_settings WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM partners WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM orgs WHERE id = $1`, [org]);
    } finally {
      await closeRlsPool();
      await close();
    }
  });

  let saved;

  test("writeSlot saves a draft inside asStaff, with no transaction open during any model call", async () => {
    const ai = fakeAnthropic([draft()]);
    const slot = { n: 1, funnel_key: "roadmap_147", script_format: "standard", style: "bullets", source: "fresh_angle", angle_key: "the_conveyor_belt", idea_id: null, reason: "U24 pg test" };
    const begunBefore = tx.begun;
    const out = await writeSlot(pool, ENV, { batch, slot }, { orgId: org, fetchImpl: ai.fetchImpl });
    assert.ok(out.script_id, JSON.stringify(out));
    assert.equal(out.flagged, false, JSON.stringify(out.check_results && out.check_results.flag_reasons));

    assert.ok(ai.calls.length >= 2, "a writer call and a judge call");
    for (const c of ai.calls) {
      assert.equal(c.openTx, 0, `a transaction was open during the ${c.kind} call`);
      assert.equal(new URL(c.url).host, "api.anthropic.com");
    }
    assert.ok(tx.begun - begunBefore >= 3, "the writer's reads, screens and save ran in transactions");
    assert.equal(tx.open, 0, "every transaction was closed");

    const row = (await db.query(
      `SELECT id, root_script_id, version, status, source, batch_id, funnel_key, script_format, style,
              lane::text AS lane, angle_key, hook_key, offer_key, script_type, partner_id, hook_text,
              parts, animation_plan, meta_copy, check_results, archived_at
         FROM ad_scripts WHERE id = $1`, [out.script_id])).rows[0];
    assert.ok(row, "the row exists");
    assert.equal(row.status, "draft");
    assert.equal(row.source, "machine");
    assert.equal(row.version, 1);
    assert.equal(row.root_script_id, row.id, "a new script is its own root");
    assert.equal(row.batch_id, batch.id);
    assert.equal(row.partner_id, house);
    assert.equal(row.funnel_key, "roadmap_147");
    assert.equal(row.script_format, "standard");
    assert.equal(row.style, "bullets");
    assert.equal(row.lane, "uwiq");
    assert.equal(row.offer_key, "slo_roadmap");
    assert.equal(row.angle_key, "the_conveyor_belt");
    assert.equal(row.hook_key, "lenders_read_two_files_u24");
    assert.equal(row.script_type, "cold");
    assert.equal(row.hook_text, HOOK);
    assert.equal(row.archived_at, null);
    assert.equal(row.parts.length, 7);
    assert.equal(row.animation_plan[0].template, "FileItems");
    assert.deepEqual(row.animation_plan[0].props, {});
    assert.equal(row.meta_copy.headline, "See both files first");
    assert.equal(row.check_results.flagged, false);
    assert.equal(row.check_results.strict.passed, true);
    assert.equal(row.check_results.judge.ran, true);
    saved = row;
  });

  test("the row and its ad_labels are visible to the house partner under row security, and not to another partner", async () => {
    assert.ok(saved, "needs the first test");
    const mine = await asPartner(house, (t) => t.query(`SELECT id FROM ad_scripts WHERE id = $1`, [saved.id]));
    assert.equal(mine.rows.length, 1);
    const labels = await asPartner(house, (t) => t.query(
      `SELECT kind, key, name FROM ad_labels WHERE org_id = $1 ORDER BY kind, key`, [org]));
    const got = labels.rows.map((r) => `${r.kind}:${r.key}`);
    for (const want of ["angle:the_conveyor_belt", "hook:lenders_read_two_files_u24", "offer:slo_roadmap", "script_type:cold"]) {
      assert.ok(got.includes(want), `${want} in ${got.join(", ")}`);
    }
    assert.equal(labels.rows.find((r) => r.key === "the_conveyor_belt").name, "The Conveyor Belt", "the angle's name comes from angles.json");
    if (rlsIsReal()) {
      const theirs = await asPartner(other, (t) => t.query(`SELECT id FROM ad_scripts WHERE id = $1`, [saved.id]));
      assert.equal(theirs.rows.length, 0, "another partner cannot see the house script");
    }
  });

  test("no repo_outbox row is written for a draft", async () => {
    const r = await db.query(`SELECT count(*)::int AS n FROM repo_outbox WHERE org_id = $1`, [org]);
    assert.equal(r.rows[0].n, 0);
  });

  test("every model call is in marketing_model_usage with the model that served it", async () => {
    const r = await db.query(
      `SELECT model, count(*)::int AS n, sum(cache_write_tokens)::int AS cw, bool_and(cost_usd IS NOT NULL) AS priced
         FROM marketing_model_usage WHERE org_id = $1 AND batch_id = $2 GROUP BY model ORDER BY model`, [org, batch.id]);
    assert.deepEqual(r.rows.map((x) => x.model), ["claude-opus-5-5", "claude-sonnet-5-5"]);
    for (const x of r.rows) {
      assert.equal(x.priced, true, `${x.model} has a price`);
      assert.ok(x.cw > 0, "cache write tokens are kept");
    }
  });

  test("fixScript on a locked script: same root, same ad number, still locked, old version archived", async () => {
    assert.ok(saved, "needs the first test");
    await db.query(
      `UPDATE ad_scripts SET status = 'locked', ad_id = '90024', locked_at = now() WHERE id = $1`, [saved.id]);
    const ai = fakeAnthropic([draft("Tap below and get your Roadmap. It is a soft pull only, so there is zero impact on your score, and nothing moves until you say so.")]);
    const note = "Say 'get your Roadmap' in the CTA.";
    const out = await fixScript(pool, ENV, { script_id: saved.id, version: 1, note }, { orgId: org, fetchImpl: ai.fetchImpl });
    assert.ok(out.script_id, JSON.stringify(out));
    for (const c of ai.calls) assert.equal(c.openTx, 0, `a transaction was open during the ${c.kind} call`);
    assert.equal(tx.open, 0);

    const rows = (await db.query(
      `SELECT id, version, status, ad_id, root_script_id, parent_script_id, archived_at, fix_note, source, locked_at
         FROM ad_scripts WHERE root_script_id = $1 ORDER BY version`, [saved.id])).rows;
    assert.equal(rows.length, 2);
    const [v1, v2] = rows;
    assert.ok(v1.archived_at, "the old version is archived");
    assert.equal(v1.status, "superseded");
    assert.equal(v2.id, out.script_id);
    assert.equal(v2.version, 2);
    assert.equal(v2.status, "locked", "a locked script's fix stays locked");
    assert.equal(v2.ad_id, "90024", "the ad number is kept");
    assert.equal(v2.root_script_id, saved.id);
    assert.equal(v2.parent_script_id, saved.id);
    assert.equal(v2.archived_at, null);
    assert.equal(v2.fix_note, note);
    assert.equal(v2.source, "machine");
    assert.ok(v2.locked_at, "who locked it and when is carried over");

    const stale = await fixScript(pool, ENV, { script_id: saved.id, version: 1, note: "again" }, { orgId: org, fetchImpl: fakeAnthropic([draft()]).fetchImpl });
    assert.equal(stale.failed, true, "a fix of an old version is skipped");
    const outbox = await db.query(`SELECT count(*)::int AS n FROM repo_outbox WHERE org_id = $1`, [org]);
    assert.equal(outbox.rows[0].n, 0, "a fix enqueues no repo write either");
  });

  const ideaSlot = (ideaId, n) => ({ n, funnel_key: "roadmap_147", script_format: "standard", style: "bullets", source: "chris_idea", angle_key: null, idea_id: ideaId, reason: "U24 pg test idea" });
  const readIdea = async (id) => (await db.query(
    `SELECT status, script_id, batch_id, failure_reason, attempts FROM ad_ideas WHERE id = $1`, [id])).rows[0];

  test("a slot written from an idea sets the idea 'written' with its script and batch (414)", async () => {
    /* A new hook and CTA: the batch already holds the locked script's, and a batch
       duplicate would be refused. */
    const hook = "Most people fix the credit file the bank never even reads first on a big line, and then wonder why.";
    const cta = "Tap below to see which file your lender reads first. It is a soft pull only, so there is zero impact on your score.";
    const ai = fakeAnthropic([draft(cta, hook, "the_file_nobody_reads_u24")]);
    const out = await writeSlot(pool, ENV, { batch, slot: ideaSlot(ideas.write, 2) }, { orgId: org, fetchImpl: ai.fetchImpl });
    assert.ok(out.script_id, JSON.stringify(out));
    for (const c of ai.calls) assert.equal(c.openTx, 0, `a transaction was open during the ${c.kind} call`);
    const idea = await readIdea(ideas.write);
    assert.equal(idea.status, "written");
    assert.equal(idea.script_id, out.script_id);
    assert.equal(idea.batch_id, batch.id, "the idea is tied to the batch that wrote it");
    assert.equal(idea.attempts, 0);
    const script = (await db.query(`SELECT idea_id FROM ad_scripts WHERE id = $1`, [out.script_id])).rows[0];
    assert.equal(script.idea_id, ideas.write);
  });

  test("a refusal sets the idea 'failed' with a reason and one attempt (414 ad_ideas_failed_reason_ck)", async () => {
    const ai = fakeAnthropic([{ refusal: "cyber" }]);
    const out = await writeSlot(pool, ENV, { batch, slot: ideaSlot(ideas.refuse, 3) }, { orgId: org, fetchImpl: ai.fetchImpl });
    assert.equal(out.failed, true, JSON.stringify(out));
    assert.equal(out.temporary, false);
    const idea = await readIdea(ideas.refuse);
    assert.equal(idea.status, "failed");
    assert.ok(idea.failure_reason && idea.failure_reason.trim(), "a failed idea says why");
    assert.match(idea.failure_reason, /category: cyber/);
    assert.equal(idea.attempts, 1);
    assert.equal(idea.script_id, null);
  });

  test("a setup fault (a masked key) leaves the idea exactly as it was", async () => {
    const ai = fakeAnthropic([draft()]);
    const out = await writeSlot(pool, { ANTHROPIC_API_KEY: "****************abcd" }, { batch, slot: ideaSlot(ideas.setup, 3) }, { orgId: org, fetchImpl: ai.fetchImpl });
    assert.equal(out.failed, true);
    assert.equal(out.temporary, true, "the job runs again; then Retry works");
    assert.equal(ai.calls.length, 0);
    const idea = await readIdea(ideas.setup);
    assert.equal(idea.status, "new");
    assert.equal(idea.attempts, 0);
    assert.equal(idea.failure_reason, null);
  });
});
