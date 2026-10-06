// The avatar run, all 10 saved steps, on a fake database and a fake model. Unit X1.
//
// What this proves without Postgres or the network (the real-database half is
// src/http/marketing-flywheel.pg.test.mjs):
//   * one step per claim; the run re-queues itself between steps; step 10 finishes it
//   * a step that is done is never paid for again (no model call on a re-claim)
//   * a failed source family re-runs alone; the families that worked are not called again
//   * the run stops at its cap with the plain sentence, shrinks a batch first, and keeps
//     what it found; a run with no pass time left hands the step to the next pass
//   * quotes and findings with no matching link never reach the saved files
//   * the word bank keeps every old line and adds the new ones under one heading

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { run, FinalError } from "./run.mjs";
import { STEPS, RUN_SEARCH_CEILING } from "./plan.mjs";
import { DESIRE_SOURCES, INFO_SOURCES } from "./prompts.mjs";
import { parseBank } from "./word-bank.mjs";

const ORG = "00000000-0000-0000-0000-00000000a001";
const JOB = "00000000-0000-0000-0000-00000000b001";

const OLD_BANK = [
  "# Market Language Bank — partner funnel",
  "",
  "## 2. PAIN POINTS — in their words",
  "",
  "- **you are getting RIPPED OFF on that split** — _pain_ (DailyFunder thread)",
  "- **Are you in it for the renewals?** — _desire_ (DailyFunder thread title)",
  ""
].join("\n");

const OLD_AVATAR = "---\nstage: 1\nversion: 1\nstatus: approved\ninputs:\ncounts:\n  quotes: 133\n---\n\n# old\n";
const NOTES = "# Owner notes\n\n## Notes\n\n2026-08-31 | stage 1 | the avatar is assumed on purpose.\n2026-08-31 | stage 3 | not for this step.\n2026-08-31 | all | no compliance checking in this pipeline.\n";

/* ── a fake database: just the statements the run makes ── */
function fakeDb({ settings = { run_caps: { avatar: 20 }, max_month_cost_usd: 300 }, monthUsedUsd = 0 } = {}) {
  const st = {
    job: null, usage: [], outbox: [], buzzes: [], requeues: [], nextOutboxId: 1, monthUsedUsd
  };
  const db = {
    st,
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("UPDATE marketing_jobs SET payload")) {
        if (st.job && st.job.id === p[0] && st.job.status === "running") st.job.payload = JSON.parse(p[1]);
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith("UPDATE marketing_jobs SET status = 'queued', claimed_at = NULL")) {
        if (st.job && st.job.status === "running") {
          st.job.status = "queued";
          st.job.run_after = p[1];
          st.requeues.push(p[1]);
          return { rows: [st.job] };
        }
        return { rows: [] };
      }
      if (s.includes("FROM marketing_model_usage WHERE job_id")) {
        const rows = st.usage.filter((u) => u.job_id === p[0]);
        return { rows: [{ priced: rows.reduce((n, u) => n + (u.cost_usd == null ? 0 : Number(u.cost_usd)), 0), ni: 0, no: 0, ncr: 0, ncw: 0, ns: 0 }] };
      }
      if (s.startsWith("SELECT run_caps, max_month_cost_usd")) return { rows: settings ? [settings] : [] };
      if (s.startsWith("WITH bounds AS")) {
        const mine = st.usage.reduce((n, u) => n + (u.cost_usd == null ? 0 : Number(u.cost_usd)), 0);
        return { rows: [{ month_priced_usd: st.monthUsedUsd + mine, unpriced_rows: 0 }] };
      }
      if (s.startsWith("INSERT INTO marketing_model_usage")) {
        st.usage.push({ org_id: p[0], job_id: p[2], model: p[3], cost_usd: p[8], searches: p[9] || 0, step: p[11] || null });
        return { rows: [{ id: `u${st.usage.length}` }] };
      }
      if (s.startsWith("INSERT INTO repo_outbox")) {
        if (st.outbox.some((o) => o.op_id === p[1])) return { rows: [] };
        const row = { id: st.nextOutboxId++, org_id: p[0], op_id: p[1], path: p[2], mode: p[3], content: p[4], edit: p[5] };
        st.outbox.push(row);
        return { rows: [row] };
      }
      if (s.startsWith("SELECT id, op_id, path, mode, content, edit FROM repo_outbox")) {
        return { rows: st.outbox.filter((o) => o.op_id === p[1]) };
      }
      if (s.startsWith("INSERT INTO marketing_buzzes")) {
        const row = { id: `z${st.buzzes.length + 1}`, org_id: p[0], kind: p[1], body: p[2], group_key: p[3], created: true };
        st.buzzes.push(row);
        return { rows: [row] };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] };
      throw new Error(`fake db: unexpected statement: ${s.slice(0, 120)}`);
    }
  };
  return db;
}

/* ── a fake model that answers by which SOP prompt it was sent ── */
const famUrl = (i, k) => `https://forum${i}.example.com/thread/${k}`;
const famQuote = (i, k) => `family ${i} buyer says the lender backdoored me on deal number ${k} again`;

function fakeModel({ failFamilyOnce = null, missingKey = false, verdictProblems = [] } = {}) {
  const calls = [];
  let failed = false;
  const callModel = async (args) => {
    const u = String(args.user || "");
    const kind =
      u.includes("PROMPT 1 OF 7") ? "foundation" :
      u.includes("PROMPT 3 OF 7") ? "overview" :
      u.includes("PROMPT 4 OF 7") ? "desire" :
      u.includes("Assemble Desire_Market_Research.md") ? "desire_assemble" :
      u.includes("PROMPT 5 OF 7") ? "mechanism" :
      u.includes("PROMPT 6 OF 7") ? "info" :
      u.includes("Assemble New_Information.md") ? "info_assemble" :
      u.includes("PROMPT 7 OF 7") ? "avatar" :
      u.includes("Adversarially review") ? "verify" :
      u.includes("Repair this Core Avatar Profile") ? "repair" : "unknown";
    calls.push({ kind, args });
    const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
    if (missingKey) return { error: "not sent: ANTHROPIC_API_KEY is not set, so Claude was not called.", usage: { ...usage, input_tokens: 0, output_tokens: 0 }, content: [] };
    if (kind === "desire") {
      const i = DESIRE_SOURCES.findIndex((s) => u.includes(s));
      if (failFamilyOnce === i && !failed) {
        failed = true;
        return { error: "anthropic 529: overloaded", status: 529, usage: { ...usage, input_tokens: 0, output_tokens: 0 }, content: [] };
      }
      const json = {
        findings: `family ${i} notes`,
        quotes: [
          { quote: famQuote(i, 1), source: famUrl(i, 1), tag: "pain" },
          { quote: `family ${i} paraphrased line about renewals and who owns them`, source: famUrl(i, 2), paraphrase: true, tag: "desire" },
          { quote: `family ${i} INVENTED quote that has no real link at all here`, source: `https://invented${i}.example.net/nowhere` },
          { quote: "you are getting RIPPED OFF on that split", source: famUrl(i, 2), tag: "pain" }
        ],
        nothingNew: false
      };
      return {
        error: null, usage: { ...usage, web_search_requests: 2 }, servedModel: args.model,
        content: [
          { type: "server_tool_use", id: "s", name: "web_search", input: { query: "q" } },
          { type: "web_search_tool_result", tool_use_id: "s", content: [
            { type: "web_search_result", url: famUrl(i, 1), title: "t", encrypted_content: "e" },
            { type: "web_search_result", url: famUrl(i, 2), title: "t", encrypted_content: "e" }
          ] },
          { type: "text", text: "Found it.", citations: [{ type: "web_search_result_location", url: famUrl(i, 1), cited_text: famQuote(i, 1) }] },
          { type: "text", text: JSON.stringify(json) }
        ]
      };
    }
    if (kind === "info") {
      const i = INFO_SOURCES.findIndex((s) => u.includes(s));
      const json = { findings: [
        { source: `https://report${i}.example.org/a`, publication: "Report", information: `fact ${i}`, why_new: "new", how_to_use: "carefully", hooks: ["a", "b", "c"] },
        { source: "https://never-searched.example.org/z", information: "an invented statistic" }
      ], nothingNew: false };
      return {
        error: null, usage: { ...usage, web_search_requests: 1, web_fetch_requests: 1 }, servedModel: args.model,
        content: [
          { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: `https://report${i}.example.org/a`, title: "r" }] },
          { type: "text", text: JSON.stringify(json) }
        ]
      };
    }
    if (kind === "verify") {
      return { error: null, usage, servedModel: args.model, json: { problems: verdictProblems, fabricatedQuotes: [], passed: !verdictProblems.length }, content: [] };
    }
    const text = kind === "avatar" || kind === "repair"
      ? `# Core_Avatar_Profile.md\n\n## Avatar Name: "Backdoored Brandon"\n\nHe says "${famQuote(0, 1)}" and "I made ten grand my first week with zero effort".\n`
      : kind === "desire_assemble"
        ? "# Desire_Market_Research.md\n\n## 4. Client Voice Evidence\n\nSECTION 4 IS FILLED IN BY THE CHECKER.\n\n## 5. New Desire Opportunities\n\nx\n"
        : `# ${kind} document\n\nBody for ${kind}.`;
    return { error: null, usage, servedModel: args.model, text, content: [{ type: "text", text }] };
  };
  return { calls, callModel };
}

const files = {
  "marketing/flywheel/partner/00-OWNER-NOTES.md": NOTES,
  "marketing/flywheel/partner/01-avatar/Market_Language_Bank.md": OLD_BANK,
  "marketing/flywheel/partner/01-avatar.md": OLD_AVATAR,
  "marketing/testimonials/testimonials.json": JSON.stringify([{ client_name: "Colin Schmidt", business_type: "Business owner", hook_source_quote: "So the total in funding was around the number he wanted.", status: "live" }])
};
const readRepoFile = async (p) => (Object.prototype.hasOwnProperty.call(files, p) ? { content: files[p], source: "bundle-fallback" } : { content: null, source: "missing" });

function newJob(extra = {}) {
  return {
    id: JOB, org_id: ORG, kind: "avatar", status: "queued", attempts: 0, created_at: new Date("2026-10-06T12:00:00Z").toISOString(),
    payload: { campaign: "partner", step: "foundation", service_description: "The Fundhub partnership.", run_cap_usd: 20, progress: {}, ...extra }
  };
}

/** One worker claim: running → run() → done when it returned a summary and is still running. */
async function claim(db, model, { now = () => new Date("2026-10-06T12:00:00Z"), finishByMs } = {}) {
  const job = db.st.job;
  assert.equal(job.status, "queued", "only a queued row is claimed");
  job.status = "running";
  const snapshot = JSON.parse(JSON.stringify(job));
  const out = await run(snapshot, { db, env: { ANTHROPIC_API_KEY: "test" }, deps: { callModel: model.callModel, now, readRepoFile }, finishByMs });
  if (job.status === "running") { job.status = "done"; job.result = out; }
  return out;
}

describe("avatar run: one step per claim, all ten steps", () => {
  test("runs every step in order, stops quote rounds after two dry rounds, saves eight files and one buzz", async () => {
    const db = fakeDb();
    db.st.job = newJob();
    const model = fakeModel();
    const order = [];
    for (let i = 0; i < 30 && db.st.job.status !== "done"; i++) {
      const before = db.st.job.payload.step;
      const callsBefore = model.calls.length;
      await claim(db, model);
      order.push({ step: before, calls: model.calls.slice(callsBefore).map((c) => c.kind) });
    }
    assert.equal(db.st.job.status, "done");
    assert.equal(db.st.job.payload.step, "done");

    // One step per claim: every claim's calls belong to the one step it started on.
    const want = {
      foundation: ["foundation"], overview: ["overview"], quotes: ["desire"], sort: ["desire_assemble", "mechanism"],
      word_bank: [], new_info: ["info"], facts: ["info_assemble"], avatar: ["avatar"], check: ["verify", "repair"], save: []
    };
    for (const o of order) {
      for (const k of o.calls) assert.ok(want[o.step].includes(k), `claim on ${o.step} made a ${k} call`);
    }
    assert.deepEqual([...new Set(order.map((o) => o.step))], STEPS.map((s) => s.key));

    // Quotes: round 1 finds new quotes, rounds 2 and 3 find nothing new → stop at 3 rounds.
    const quoteClaims = order.filter((o) => o.step === "quotes");
    assert.equal(quoteClaims.length, 3);
    for (const c of quoteClaims) assert.equal(c.calls.length, DESIRE_SOURCES.length);
    // The check runs on two claims: the two checkers, then the repair half (no problem
    // found here, so it re-checks the quotes and makes no repair call).
    assert.equal(order.filter((o) => o.step === "check").length, 2);

    // Totals: 1+1+15+2+3+1+1+2 calls (no problems → no repair call).
    assert.equal(model.calls.length, 26);
    assert.equal(model.calls.filter((c) => c.kind === "repair").length, 0);

    // Every call is in the ledger with its step.
    assert.equal(db.st.usage.length, 26);
    assert.ok(db.st.usage.every((u) => u.job_id === JOB && u.step));

    // Searches: never past the ceiling; each quote call asked for at most 8.
    for (const c of model.calls.filter((x) => x.kind === "desire")) {
      assert.equal(c.args.tools[0].type, "web_search_20260318");
      assert.deepEqual(c.args.tools[0].allowed_callers, ["direct"]);
      assert.ok(c.args.tools[0].max_uses <= 8);
      assert.equal(c.args.provider, "anthropic");
      assert.equal(c.args.model, "claude-sonnet-5-5");
    }
    for (const c of model.calls.filter((x) => x.kind === "info")) {
      assert.deepEqual(c.args.tools.map((t) => t.type), ["web_search_20260318", "web_fetch_20260318"]);
      assert.equal(c.args.tools[1].max_uses, 3);
    }
    assert.ok(db.st.job.payload.progress.searches_used <= RUN_SEARCH_CEILING);
    for (const c of model.calls.filter((x) => ["foundation", "avatar", "repair"].includes(x.kind))) assert.equal(c.args.model, "claude-opus-5-5");

    // The owner notes for step 1 (stage 1 and "all" lines only) rode into the prompts.
    const p1 = model.calls[0].args.user;
    assert.match(p1, /the avatar is assumed on purpose/);
    assert.match(p1, /no compliance checking in this pipeline/);
    assert.doesNotMatch(p1, /not for this step/);
    assert.match(p1, /Colin Schmidt/);

    // Eight files through the outbox, all under the campaign's 01-avatar.
    const paths = db.st.outbox.map((o) => o.path).sort();
    assert.deepEqual(paths, [
      "marketing/flywheel/partner/01-avatar.md",
      "marketing/flywheel/partner/01-avatar/Desire_Market_Research.md",
      "marketing/flywheel/partner/01-avatar/Market_Language_Bank.md",
      "marketing/flywheel/partner/01-avatar/New_Information.md",
      "marketing/flywheel/partner/01-avatar/New_Mechanisms.md",
      "marketing/flywheel/partner/01-avatar/Service_Business_Foundation.md",
      "marketing/flywheel/partner/01-avatar/Service_Overview.md",
      "marketing/flywheel/partner/01-avatar/Sources.md"
    ]);
    const byPath = Object.fromEntries(db.st.outbox.map((o) => [o.path.split("/").pop(), o.content]));

    // No invented link reached any saved file.
    for (const content of Object.values(byPath)) {
      assert.doesNotMatch(content, /invented\d\.example\.net/);
      assert.doesNotMatch(content, /never-searched\.example\.org/);
    }
    // Section 4 is the checker's list, with links.
    assert.match(byPath["Desire_Market_Research.md"], /## 4\. Client Voice Evidence \(Direct Quotes\) — checked by the server/);
    assert.match(byPath["Desire_Market_Research.md"], new RegExp(famUrl(0, 1).replace(/[./]/g, "\\$&")));
    assert.doesNotMatch(byPath["Desire_Market_Research.md"], /SECTION 4 IS FILLED IN/);

    // The stamp: version 2 (the old file was version 1), draft, counts the gate reads.
    const main = byPath["01-avatar.md"];
    assert.match(main, /^---\nstage: 1\nversion: 2\nstatus: draft\nbuilt_by: server\n/);
    // 2 checked quotes per family (1 word for word, 1 paraphrase) x 5, plus the
    // "RIPPED OFF" line every family re-found (a real link, kept once).
    assert.match(main, /\n  quotes: 11\n/);
    assert.match(main, /\n  verbatim: 5\n/);
    assert.match(main, /## Review card/);
    assert.match(main, /the buyer is "Backdoored Brandon"/);
    // The invented quote in the avatar is marked, the real one is not.
    assert.match(main, /zero effort" \[UNCHECKED\]/);
    assert.doesNotMatch(main, new RegExp(`${famQuote(0, 1)}" \\[UNCHECKED\\]`));

    // The word bank: every old line kept, the new ones added once under one heading.
    const bank = byPath["Market_Language_Bank.md"];
    assert.ok(bank.startsWith(OLD_BANK.trimEnd()), "the old bank is kept word for word");
    const entries = parseBank(bank);
    assert.equal(entries.length, 2 + 10, "the old 2, plus 10 new (the re-found old line is not added twice)");
    assert.equal((bank.match(/## Added by the server run on/g) || []).length, 1);

    // One buzz, in words.
    assert.equal(db.st.buzzes.length, 1);
    assert.equal(db.st.buzzes[0].body, "The avatar for Partner offer is ready to read.");

    // The summary the worker saves on the row.
    const result = db.st.job.result;
    assert.equal(result.version, 2);
    assert.equal(result.counts.newQuotes, 10);
    assert.equal(result.counts.keptEntries, 2);
    assert.equal(result.sentence, "Done. 10 new quotes, 2 kept. Version 2, built on the server. Not reviewed.");
  });

  test("a finished step is never paid for twice: a re-claim after a crash skips it", async () => {
    const db = fakeDb();
    db.st.job = newJob();
    const model = fakeModel();
    await claim(db, model); // foundation
    assert.equal(db.st.job.payload.step, "overview");
    // A crash after the step was saved but before the row moved on.
    db.st.job.payload.step = "foundation";
    await claim(db, model);
    assert.deepEqual(model.calls.map((c) => c.kind), ["foundation", "overview"], "foundation ran once");
  });

  test("a failed source family re-runs alone; the four that worked are not called again", async () => {
    const db = fakeDb();
    db.st.job = newJob({ step: "quotes", progress: { steps: { foundation: { status: "done" }, overview: { status: "done" } }, docs: { foundation: "f", overview: "o" } } });
    const model = fakeModel({ failFamilyOnce: 2 });
    await assert.rejects(claim(db, model), /1 of the quote searches in round 1 failed/);
    assert.equal(model.calls.length, 5);
    // The worker would put it back in the queue; do the same.
    db.st.job.status = "queued";
    await claim(db, model);
    const second = model.calls.slice(5);
    assert.equal(second.length, 1);
    assert.ok(second[0].args.user.includes(DESIRE_SOURCES[2]));
    assert.equal(db.st.job.payload.progress.quotes.round, 2, "the round finished and the next one is due");
  });
});

describe("avatar run: the check and repair", () => {
  test("a problem the checkers find gets one repair call, on its own claim; the problems reach the review card", async () => {
    const db = fakeDb();
    const docs = { foundation: "f", overview: "o", desire: "d", mechanism: "m", info: "i", bank: OLD_BANK, avatar: "# Core_Avatar_Profile.md\n\n## Avatar Name: \"Brandon\"\n" };
    const done = Object.fromEntries(["foundation", "overview", "quotes", "sort", "word_bank", "new_info", "facts", "avatar"].map((k) => [k, { status: "done" }]));
    db.st.job = newJob({ step: "check", progress: { steps: done, docs, quotes: { kept: [] } } });
    const model = fakeModel({ verdictProblems: ["The Core Desire could describe any business owner."] });
    await claim(db, model);
    assert.deepEqual(model.calls.map((c) => c.kind), ["verify", "verify"]);
    assert.equal(db.st.job.payload.step, "check", "the repair is the next claim");
    await claim(db, model);
    assert.deepEqual(model.calls.slice(2).map((c) => c.kind), ["repair"]);
    assert.match(model.calls[2].args.user, /- The Core Desire could describe any business owner\./);
    assert.equal(db.st.job.payload.step, "save");
    await claim(db, model);
    const main = db.st.outbox.find((o) => o.path.endsWith("01-avatar.md")).content;
    assert.match(main, /\*\*Three things to check:\*\* 1\) The Core Desire could describe any business owner\./);
  });
});

describe("avatar run: caps and time", () => {
  test("stops at the run cap with the plain sentence, keeps what it has, and never starts the call", async () => {
    const db = fakeDb();
    // One search call's worst case is about $0.46: a $0.40 cap fits none.
    db.st.job = newJob({ run_cap_usd: 0.4, step: "quotes", progress: { steps: { foundation: { status: "done" }, overview: { status: "done" } }, docs: { foundation: "f", overview: "o" } } });
    const model = fakeModel();
    await assert.rejects(claim(db, model), (err) => {
      assert.ok(err instanceof FinalError);
      assert.equal(err.final, true);
      assert.equal(err.message, "Stopped at the $0.40 run cap after step 2. What it found so far is saved. Raise the cap in Settings and tap Retry to finish.");
      return true;
    });
    assert.equal(model.calls.length, 0);
    assert.equal(db.st.job.payload.progress.stopped_at_cap.cap, "run");
    assert.equal(db.st.job.payload.progress.docs.foundation, "f");
  });

  test("shrinks a quote round to what fits before stopping, and says so", async () => {
    const db = fakeDb();
    // One search call's worst case is about $0.46: $1 of room runs 2 of the 5 families.
    db.st.job = newJob({ run_cap_usd: 1, step: "quotes", progress: { steps: { foundation: { status: "done" }, overview: { status: "done" } }, docs: { foundation: "f", overview: "o" } } });
    const model = fakeModel();
    await claim(db, model);
    assert.equal(model.calls.length, 2);
    assert.deepEqual(db.st.job.payload.progress.shrunk, ["Round 1 read 2 of 5 source families to stay under $1."]);
  });

  test("the month cap stops the run too", async () => {
    const db = fakeDb({ monthUsedUsd: 299.9 });
    db.st.job = newJob();
    const model = fakeModel();
    await assert.rejects(claim(db, model), /Stopped at the \$300 month cap/);
    assert.equal(model.calls.length, 0);
  });

  test("with too little of the pass left, the step goes to the next pass: no call, no attempt", async () => {
    const db = fakeDb();
    db.st.job = newJob();
    const model = fakeModel();
    const now = new Date("2026-10-06T12:00:00Z");
    const out = await claim(db, model, { now: () => now, finishByMs: now.getTime() + 60_000 });
    assert.deepEqual(out, { handed_on: true, step: "foundation" });
    assert.equal(model.calls.length, 0);
    assert.equal(db.st.job.status, "queued");
    assert.ok(new Date(db.st.requeues[0]).getTime() > now.getTime() + 60_000);
  });

  test("no Anthropic key is a final error in plain words", async () => {
    const db = fakeDb();
    db.st.job = newJob();
    await assert.rejects(claim(db, fakeModel({ missingKey: true })), (err) => err.final === true && err.message === "No Anthropic key is set on the site. An agent must set it.");
  });
});
