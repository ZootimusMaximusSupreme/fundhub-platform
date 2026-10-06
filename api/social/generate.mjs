// POST /api/social/generate — write post captions from the partner's brand.
//
// TWO THINGS ARE DELIBERATE HERE, and both exist because this endpoint used to
// leave Social Studio stuck on "Writing…" with nothing saved.
//
//   1. THE MODEL CALL HAPPENS WITH NO TRANSACTION OPEN. It used to sit inside the
//      same withPartnerScope block as the inserts, so a slow reply held a database
//      connection open for its whole length, and when the platform killed the
//      function every row written in that transaction rolled back. The work is now
//      three short steps: read what we need, call the model with nothing held, then
//      write. A kill between steps can no longer erase a completed step.
//
//   2. THE MODEL CALL IS BOUNDED BY US, not by the platform. src/agents/model.mjs
//      sets no timeout and is not this thread's file to change, but it does accept
//      a fetchImpl — so the abort signal is attached from here. The bound is under
//      the function's own limit on purpose: being killed produces no reply at all,
//      while failing ourselves produces a sentence the partner can read.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { safeError } from "../../src/http/health.mjs";
import { callModel, DEFAULT_MODEL } from "../../src/agents/model.mjs";
import { readWithBackupReader } from "../../src/handlers/doc-check.mjs";
import { screen } from "../../src/compliance/screen.mjs";
import {
  assertSuiteEnabled, assertUnderCap, recordUsage, SUITE_OFF, CAP_HIT
} from "../../src/brand/meter.mjs";

const SYSTEM = [
  "You write short social posts for a regulated funding-review firm.",
  "Return a JSON array of strings. No markdown.",
  "Hard rules: never guarantee approval, a funding amount, a credit-score change, or a timeline.",
  "Never invent testimonials. The firm is not a direct lender."
].join("\n");

function parseCaptions(text, want) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  let arr = [];
  if (start >= 0 && end > start) {
    try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { arr = []; }
  }
  if (!Array.isArray(arr) || !arr.length) {
    arr = raw.split(/\n+/).map((s) => s.replace(/^\s*[-*\d.]+\s*/, "").trim()).filter(Boolean);
  }
  return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, want);
}

/* HOW LONG WE WAIT FOR THE MODEL.
   Netlify's default limit for a synchronous function is 10 seconds and this repo
   sets no override for the `api` function in netlify.toml, so anything past that
   is killed with no reply. 8.5s leaves room for the two short database steps
   either side and still returns our own message rather than a dead request.
   Raise SOCIAL_GENERATE_TIMEOUT_MS only alongside the function's own limit —
   a value above it puts the kill back in charge. */
const MODEL_TIMEOUT_MS = Math.max(
  1000, Number(process.env.SOCIAL_GENERATE_TIMEOUT_MS) || 8500
);

/* callModelBounded — callModel with an abort attached.

   Promise.race is the wrong tool here and was considered: the losing side keeps
   running, so the real request would still be in flight behind the timeout. An
   AbortController ends the request itself. The timer is cleared only after
   callModel returns, so the bound covers reading the reply body as well as
   waiting for the first byte.

   No key means callModel returns its shadow result before it ever reaches
   fetchImpl, so the keyless path is unchanged. */
export async function callModelBounded(args, ms = MODEL_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  try {
    const out = await callModel({
      ...args,
      fetchImpl: (url, init) =>
        globalThis.fetch(url, { ...init, signal: controller.signal })
    });
    return { ...out, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/* callWriter — the model call, plus the backup writer when OpenAI has no credit.

   WHY. "Write 3 posts for me" wrote nothing on fundhub.ai (marketing-fixes
   2026-09-17, F3). The OpenAI key production holds is a real key on an empty
   account: measured live 2026-09-18 08:52 UTC, `openai 429 … insufficient_quota,
   You have no credits remaining`, and the 2026-09-17 23:17 press recorded
   gpt-4o-mini with 0 tokens AFTER the masked-key fix shipped. callModel only
   turns to Anthropic when no OpenAI key is set at all, so the working Anthropic
   key was never asked.

   This is the same backup the ID reader already uses (readWithBackupReader,
   src/handlers/doc-check.mjs): only when the first call went to OpenAI and
   OpenAI said "no credit", ask Anthropic once with the OpenAI keys left out of
   that one call's copy of the environment. The stored key is not touched
   (CLAUDE.md §11). If the backup fails too, the first result stands.

   The backup gets what is left of the same time bound, so the two calls
   together still finish before the platform's limit. A first call that timed
   out is returned as it is: there is no time left for a second. */
export async function callWriter(args, {
  ms = MODEL_TIMEOUT_MS, bounded = callModelBounded, now = Date.now
} = {}) {
  const started = now();
  const first = await bounded(args, ms);
  if (first.timedOut) return first;
  const left = Math.max(1000, ms - (now() - started));
  const backup = await readWithBackupReader(first, {
    env: args.env,
    modelArgs: args,
    callModelImpl: (a) => bounded(a, left)
  });
  return backup || first;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;
  const body = req.body || {};
  const partnerId = resolvePartnerId(principal, {
    partner_id: body.partner_id || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }
  const count = Math.min(8, Math.max(1, Number(body.count) || 3));
  const offerType = body.offer_type || "funding";

  const scope = { kind: "partner", partnerId };

  try {
    // STEP 1 — a short read. Is this switched on, is there budget left, and what
    // does this partner sound like? Nothing slow runs with this open.
    const setup = await withPartnerScope(scope, async (tx) => {
      await assertSuiteEnabled(tx, partnerId);
      await assertUnderCap(tx, partnerId);
      const org = (await tx.query(
        `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
      )).rows[0];
      if (!org) {
        const e = new Error("partner not found");
        e.code = "NOT_FOUND";
        throw e;
      }
      const brand = (await tx.query(
        `SELECT entity_name, voice, ink, display_face FROM partner_brand WHERE partner_id = $1`,
        [partnerId]
      )).rows[0] || {};
      return { orgId: org.org_id, brand };
    });

    // STEP 2 — the model call. No transaction, no database connection held.
    // OpenAI first; Anthropic once if OpenAI says "no credit" (callWriter).
    const model = await callWriter({
      system: SYSTEM,
      user: [
        `Brand: ${setup.brand.entity_name || "the partner"}`,
        `Voice: ${setup.brand.voice || "plain"}`,
        `Write ${count} distinct posts. Each under 280 characters.`
      ].join("\n"),
      env: process.env,
      model: DEFAULT_MODEL,
      maxTokens: 800
    });

    // STEP 3 — write down what it cost, whatever the answer was. This used to sit
    // inside the same transaction as the refusal below, so a failed call left no
    // record of the tokens it had already spent and the budget under-counted.
    await withPartnerScope(scope, (tx) => recordUsage(tx, {
      orgId: setup.orgId,
      partnerId,
      purpose: "social",
      inputTokens: model.usage?.input_tokens,
      outputTokens: model.usage?.output_tokens,
      model: model.request?.model
    }));

    if (model.timedOut) {
      const e = new Error("the writing did not finish in time");
      e.code = "model_timeout";
      throw e;
    }
    if (model.mode === "shadow" || model.error || !model.text) {
      const e = new Error(model.error || "the writing robot is not set on this site");
      e.code = "no_model";
      throw e;
    }

    // STEP 4 — a short write. Every post is screened and saved, or none is.
    const captions = parseCaptions(model.text, count);
    const items = await withPartnerScope(scope, async (tx) => {
      const out = [];
      for (const caption of captions) {
        const verdict = await screen(tx, {
          orgId: setup.orgId,
          partnerId,
          kind: "social_post",
          offerType,
          platform: null,
          text: caption,
          aiGenerated: true,
          approveBeforeLaunch: true
        });
        const status = verdict.state === "blocked" ? "blocked" : "draft";
        const ins = await tx.query(
          `INSERT INTO marketing_content_queue
             (org_id, partner_id, caption, offer_type, status, blocked_reasons)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)
           RETURNING *`,
          [setup.orgId, partnerId, caption, offerType, status,
           JSON.stringify(verdict.reasons || [])]
        );
        out.push(ins.rows[0]);
      }
      return out;
    });
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "not_found" });
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    if (err.code === CAP_HIT) {
      return res.status(429).json({ ok: false, error: "token_cap",
        message: "This partner has used this month's writing budget.",
        usage: err.usage || null });
    }
    if (err.code === "model_timeout") {
      // Said as its own thing, not folded into no_model. "Not set up" and "took
      // too long" call for different next steps, and the partner is the one who
      // has to choose between waiting and telling somebody.
      return res.status(504).json({ ok: false, error: "model_timeout",
        message: "The writing took too long and was stopped. Nothing was saved. Try again." });
    }
    if (err.code === "no_model") {
      return res.status(503).json({ ok: false, error: "no_model",
        message: "The writing robot is not set on this site." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
