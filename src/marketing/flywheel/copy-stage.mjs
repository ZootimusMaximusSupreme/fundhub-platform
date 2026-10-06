// @ts-check
// Flywheel step 4, "Ad copy", on the server: .claude/workflows/copy.js ported to
// saved steps on the marketing worker, so the Ideas tab's "Write the copy"
// button does what `/flywheel stage 4` did in chat.
//
// Design docs/specs/command-center-design-2026-10-05.md §2 J4 and §3.2 row 4
// ("Writes 15 to 20 whole ads in three lengths plus email subjects ... Progress
// angles -> written N of 20 -> cleaned N of 60 -> checks"; "The copy stage
// checkpoints per piece ... and re-queues itself under the 15-minute worker
// cap"). Unit X3.
//
// THE SAME PHASES, THE SAME PROMPTS (only the chat-only lines are gone), THE
// SAME CHECKS IN CODE: Angles (the dog food exercise) -> Write (one whole ad per
// reason, three lengths, email subjects) -> Humanize (banScan, then a reader and
// a rewrite, up to 3 passes; still dirty = dropped; numbers sanded off =
// dropped) -> Verify (closing lines that collapse across reasons are dropped by
// code, then the promise, voice and sameness lenses) -> Assemble (the document
// with the review card) -> Save (stamped 04-copy.md through the outbox).
//
// Model split (design §7 question 6, recommended default): Opus writes the plan
// and the document; Sonnet writes the pieces and does the checking.
//
// Inputs come from the campaign's files as the dashboard sees them
// (reader.mjs: GitHub, then pending saves, then the bundle): the offer
// (03-offer.md), the buyer (01-avatar.md), the market's own words
// (01-avatar/Market_Language_Bank.md) and Chris's notes for stage 4. The stamp
// records the offer and word-bank hashes, which is what makes this file go out
// of date when either changes (scripts/flywheel/status.mjs STAGES[3]).

import { runSteps, OPUS, SONNET, StageStop, callReserveUsd } from "./steps.mjs";
import { banScan, keepsSpecifics, specificTokens, ctaCollisions, pieceText, pieceId } from "./copy-checks.mjs";
import { readFlywheel } from "./reader.mjs";
import { campaignWords, notesForStage } from "./campaigns.mjs";
import { stampStage, nextVersion, hashOf, bodyOf } from "./stamp.mjs";
import { saveStageFile, todayArizona } from "./save.mjs";

export const STAGE = 4;
export const FILE = "04-copy.md";
export const BATCH = 5;
export const MAX_PASSES = 3;
export const ANDROMEDA_FLOOR = 15;

const str = { type: "string" };

export const ANGLES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["angles", "fewerThanAskedBecause"],
  properties: {
    angles: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["angleId", "theReason", "audience", "hookType", "theSpecificPain", "whyItIsDifferent", "ownClosingIdea"],
        properties: {
          angleId: str, theReason: str,
          audience: { type: "string", enum: ["in-market", "needs-convinced"] },
          hookType: str, theSpecificPain: str, whyItIsDifferent: str, ownClosingIdea: str
        }
      }
    },
    fewerThanAskedBecause: str
  }
};

export const PIECE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["pieces", "emailSubjects"],
  properties: {
    pieces: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["length", "hook", "body", "cta"],
        properties: { length: { type: "string", enum: ["short", "mid", "long"] }, hook: str, body: str, cta: str }
      }
    },
    emailSubjects: { type: "array", items: str }
  }
};

const FINDINGS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["findings"],
  properties: { findings: { type: "array", items: str } }
};

const REWRITE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["hook", "body", "cta"],
  properties: { hook: str, body: str, cta: str }
};

const ISSUES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["issues"],
  properties: { issues: { type: "array", items: str } }
};

const NO_NEW_FACTS = `HARD RULE: copy may not introduce a single new fact. Every number, result,
testimonial and claim must already appear in the offer document above. If a piece needs a proof
point that is not there, rewrite the piece - do not invent the fact. This is stricter than the
offer stage on purpose: copy is the only thing here a stranger reads.`;

/* ── prompts (copy.js, word for word except the chat-only lines) ─────────── */

export function anglesPrompt(s) {
  return `Decide the messaging spread BEFORE any copy is written. Deciding
divergence once, deliberately, is what stops twelve writers producing three ideas in twelve hats.

READ THIS FIRST - it decides the whole shape of your answer.

Meta's Andromeda algorithm (fully rolled out ~July 2025) rewards genuinely different MESSAGING,
not creative volume. One argument said many subtly different ways is still ONE argument, and the
source SOP is blunt that those subtle variances are what is currently punishing advertisers. An
account holding steady cost through the rollout did it with FIFTEEN completely unique creatives,
each built around a different reason someone would care.

So you are NOT producing angles to be dressed three ways. You are running the dog food exercise:
write down every SEPARATE REASON a person would buy this, and each reason becomes one complete
ad, filmed end to end, with its hook, body and call to action all built for that one reason.

Two things that do NOT count as different reasons, and will be rejected:
- the same argument restated (a short, mid and long version of one idea is ONE reason)
- the same argument aimed at a different feeling (fear-of-X and desire-for-not-X are ONE reason)

Aim for 15 to 20 distinct reasons. If the offer genuinely only supports fewer, say so and return
what is real rather than padding the list - a padded list is the exact failure this is designed
to prevent.

THE OFFER being sold:
${s.inputs.offer.slice(0, 7000)}

THE BUYER:
${s.inputs.avatar}

${s.inputs.bank ? `THE MARKET'S OWN WORDS - copy is written from these phrases, not from your own vocabulary. This is owner-set:\n${s.inputs.bank}\n` : ""}
${s.inputs.notes ? `CORRECTIONS CHRIS HAS ALREADY MADE - these override everything:\n${s.inputs.notes}\n` : ""}

For each reason:
- angleId: short kebab-case, reused down the whole chain
- theReason: the reason itself, in the buyer's terms - why THIS person would want this
- audience: "in-market" (already believes this category works, just picking who) or
  "needs-convinced" (believes the outcome is possible, unsure this is the way)
- hookType: one of you-already-know, youre-doing-this-but, circumstance, straight-pain,
  aspirational, urgent
- theSpecificPain: the exact avatar pain or market gap this reason attacks, not a general theme
- whyItIsDifferent: one line naming what this reason has that none of the others do
- ownClosingIdea: how an ad on THIS reason should close. Every reason needs its own ending -
  a shared closing line across the whole set is the single clearest Andromeda failure and the
  script rejects it mechanically.
- fewerThanAskedBecause: why fewer than 15 came back, or "" when 15 or more did.

Lean in-market: they convert cheapest and the offer is already built for them. Mixing the two
messages in one piece is the most common way copy underperforms.`;
}

export function writePrompt(s, a) {
  return `Write ONE complete ad, built end to end around ONE reason someone buys.

This is not a hook to be pasted onto a shared body. Under Meta's Andromeda algorithm, hook,
body and close must all be aligned to your single assigned reason - filming one body and
swapping hooks onto it is the approach that stopped working. Your ad has to be able to stand
completely alone, and it must NOT end the way another ad on a different reason would end.

YOUR REASON (${a.angleId}): ${a.theReason || a.theSpecificPain}
  the pain it attacks: ${a.theSpecificPain}
  audience: ${a.audience}
  hook type: ${a.hookType}
  ${a.whyItIsDifferent ? `what only this reason has: ${a.whyItIsDifferent}` : ""}
  ${a.ownClosingIdea ? `how this one should close: ${a.ownClosingIdea}` : ""}

Write the three lengths as three cuts of THIS one ad - a short, a mid and a long telling of the
same single reason. They are lengths, not different arguments, and they are not diversification.
Diversification came from the assignment you were given.

THE OFFER:
${s.inputs.offer.slice(0, 7000)}

THE BUYER:
${s.inputs.avatar}

${s.inputs.bank ? `THE MARKET'S OWN WORDS - use these phrases, not your own vocabulary:\n${s.inputs.bank.slice(0, 5000)}\n` : ""}

Structure every piece Hook then Reasons then one CTA:
  short  2-4 lines: call out the pain, introduce the offer, CTA
  mid    5-7 lines: name the belief error, reveal the correction, anchor the offer, CTA
  long   8-12 lines: why most people in this situation stall, establish the offer as the
         blueprint, reframe acting as the smart move rather than the effortful one, CTA

Line breaks between sentences. One CTA, never a menu. Tie the CTA to the payoff, not the click.

YOUR CLOSING LINE MUST BE YOURS. Other writers are writing ads on other reasons right now, and
a generic close - "book the call and we will show you X before you pay" - is what every one of
them would write. The script compares closing lines across the whole set and drops the ones that
collapse into each other. Close on the thing YOUR reason earned, not on the offer's mechanism.

Also give 3 email subject lines for this angle.

Write like a confident founder talking to another founder. No filler. Every sentence earns the
next one. Do not use em dashes. Do not write "it's not X, it's Y".

${NO_NEW_FACTS}`;
}

function attackPrompt(full, hits) {
  return `Attack this copy for the AI tells a regex cannot catch. The
scanner has already found these, so do NOT repeat them: ${hits.map((h) => h.hit).join(", ") || "none"}

You are looking for:
- rule of three everywhere (three benefits, three adjectives, three of anything, repeatedly)
- every paragraph the same length
- staccato fragments stacked for drama
- ending on a rhetorical question when the point was already made
- anything a real person would not say out loud to another person

THE COPY:
${full}

Report only what you actually found. If it reads human, say so and return an empty list.`;
}

function rewritePrompt(full, hits, findings, tokens) {
  return `Rewrite this copy to remove every problem listed. Keep the
argument, the offer and the specifics exactly as they are - your job is voice, not vagueness.

MUST STAY IN THE COPY, verbatim: ${tokens.join(", ") || "(no specific figures in this offer)"}

THE SCANNER FOUND:
${hits.map((h) => `- ${h.kind}: ${h.hit}`).join("\n")}

A READER ALSO FOUND:
${findings.map((f) => "- " + f).join("\n") || "- nothing"}

THE COPY:
${full}

Return the rewritten hook, body and cta separately. Vary sentence length. Real sentences, just
fewer of them - do not answer in clipped fragments to save words.`;
}

function setJson(s) {
  return JSON.stringify(s.cleaned.map((p) => ({ pieceId: p.pieceId, angleId: p.angleId, hook: p.hook, body: p.body, cta: p.cta }))).slice(0, 26000);
}

export function assemblePrompt(s) {
  return `Write the copy document for ${s.campaign}, as of ${s.today}.

THE PIECES THAT PASSED (${s.cleaned.length}):
${setJson(s)}

DROPPED (${s.dropped.length}) - these did not ship:
${JSON.stringify(s.dropped.map((d) => ({ pieceId: d.pieceId, reason: d.reason, violations: d.violations }))).slice(0, 4000)}

ISSUES RAISED BY THE REVIEW LENSES:
${s.issues.map((i) => "- " + i).join("\n").slice(0, 6000)}

Lay it out so Chris can pick what to run:
1. The three hooks you would run first, and why those three.
2. Every piece, grouped by angle, with its pieceId shown. The pieceId matters - the ad in
   Facebook must be named starting with it, or spend data cannot be matched back later.
3. The email subject lines.
4. What was dropped and why.
5. What the review flagged.

Plain words. Do not rewrite the copy itself - print it as it is.

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** Read hook #1 out loud - would you say that? · Does any line promise a credit result or an income number? · Which three hooks do we run?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo`;
}

/* ── the steps ──────────────────────────────────────────────────────────── */

const reserveSonnet = (chars, maxTokens) => callReserveUsd(SONNET, { inputChars: chars, maxTokens });
const reserveOpus = (chars, maxTokens) => callReserveUsd(OPUS, { inputChars: chars, maxTokens });

/**
 * The state a fresh run starts from. Inputs are read in the first step, not
 * here, so a read that fails is a step that is tried again.
 * @param {any} job
 */
export function initState(job) {
  const p = job.payload || {};
  return {
    campaign: String(p.campaign),
    note: typeof p.note === "string" ? p.note : "",
    today: typeof p.today === "string" ? p.today : todayArizona(),
    inputs: null,
    angles: [],
    written: [],
    writeAt: 0,
    cleaned: [],
    dropped: [],
    cleanAt: 0,
    issues: [],
    collided: 0,
    distinctReasons: 0,
    document: null,
    counts: {}
  };
}

export function steps(ctx) {
  return [
    {
      name: "inputs",
      word: "reading the offer and the word bank",
      run: async (s) => {
        const read = await readFlywheel({ db: ctx.db, orgId: ctx.orgId, campaign: s.campaign, env: ctx.env, deps: (ctx.deps && ctx.deps.reader) || {} });
        const f = read.files || {};
        const text = (name) => (f[name] && f[name].text != null ? f[name].text : null);
        const offer = bodyOf(text("03-offer.md"));
        if (!offer) throw new StageStop(`There is no offer on file for ${campaignWords(s.campaign, text("00-OWNER-NOTES.md"))}. Finish step 3 (the offer) first.`);
        const notes = [notesForStage(text("00-OWNER-NOTES.md"), STAGE), s.note ? `${s.today} | stage 4 | ${s.note}` : ""]
          .filter(Boolean).join("\n");
        s.inputs = {
          offer: offer.slice(0, 8000),
          avatar: bodyOf(text("01-avatar.md")).slice(0, 7000),
          bank: bodyOf(text("01-avatar/Market_Language_Bank.md")).slice(0, 9000),
          notes: notes.slice(0, 2000),
          tokens: specificTokens(offer),
          hashes: {
            "03-offer.md": hashOf(text("03-offer.md")),
            "01-avatar/Market_Language_Bank.md": hashOf(text("01-avatar/Market_Language_Bank.md"))
          },
          version: nextVersion(text(FILE)),
          campaignName: campaignWords(s.campaign, text("00-OWNER-NOTES.md")),
          source: read.source
        };
        return "done";
      }
    },
    {
      name: "angles",
      word: "picking the separate reasons someone buys",
      run: async (s, t) => {
        if (await t.fit(1, reserveOpus(30000, 8000)) < 1) throw t.stopAtCap("picking the reasons");
        const out = await t.ask({ label: "reason-spread", model: OPUS, user: anglesPrompt(s), schema: ANGLES_SCHEMA, maxTokens: 8000, effort: "medium" });
        const seen = new Set();
        s.angles = (out.angles || []).filter((a) => {
          const id = String(a.angleId || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
          if (!id || seen.has(id)) return false;
          seen.add(id);
          a.angleId = id;
          return true;
        }).slice(0, 20);
        s.fewerBecause = out.fewerThanAskedBecause || "";
        s.counts = { ...s.counts, reasons: s.angles.length };
        if (s.angles.length < 4) {
          throw new StageStop(`Only ${s.angles.length} reasons to buy came back. That is too few to write a set from. Tap Redo.`);
        }
        return "done";
      }
    },
    {
      name: "write",
      word: (s) => `writing ad ${Math.min(s.writeAt + 1, s.angles.length || 1)} of ${s.angles.length || "15 to 20"}`,
      run: async (s, t) => {
        const chunk = s.angles.slice(s.writeAt, s.writeAt + BATCH);
        const k = await t.fit(chunk.length, reserveSonnet(25000, 4000));
        if (k < 1) throw t.stopAtCap("writing the ads");
        const batch = chunk.slice(0, k);
        const outs = await Promise.all(batch.map((a) =>
          t.ask({ label: `write-${a.angleId}`, model: SONNET, user: writePrompt(s, a), schema: PIECE_SCHEMA, maxTokens: 4000, effort: "low" })));
        outs.forEach((r, i) => {
          const a = batch[i];
          for (const p of r.pieces || []) {
            s.written.push({ pieceId: pieceId(a.angleId, p.length), angleId: a.angleId, reasonId: a.angleId,
              audience: a.audience, hookType: a.hookType, length: p.length, hook: p.hook, body: p.body, cta: p.cta });
          }
          (r.emailSubjects || []).slice(0, 3).forEach((subject, n) => s.written.push({
            pieceId: pieceId(a.angleId, `EMAIL${n + 1}`), angleId: a.angleId, reasonId: a.angleId,
            audience: a.audience, hookType: a.hookType, length: "subject", hook: subject, body: "", cta: ""
          }));
        });
        s.writeAt += batch.length;
        s.counts = { ...s.counts, written: s.written.length };
        return s.writeAt >= s.angles.length ? "done" : "more";
      }
    },
    {
      name: "humanize",
      word: (s) => `cleaning piece ${Math.min(s.cleanAt + 1, s.written.length || 1)} of ${s.written.length}`,
      run: async (s, t) => {
        const chunk = s.written.slice(s.cleanAt, s.cleanAt + BATCH);
        // A dirty piece can take 3 passes of 2 calls; a clean one takes none.
        const dirty = chunk.filter((p) => banScan(pieceText(p)).length).length;
        if (dirty) {
          const k = await t.fit(dirty, reserveSonnet(6000, 2000) * 2 * MAX_PASSES);
          if (k < dirty) throw t.stopAtCap("cleaning the ads");
        }
        const results = await Promise.all(chunk.map((piece) => cleanOne(piece, s, t)));
        for (const r of results) {
          if (r.keep) s.cleaned.push(r.keep);
          else s.dropped.push(r.drop);
        }
        s.cleanAt += chunk.length;
        s.counts = { ...s.counts, cleaned: s.cleaned.length, dropped: s.dropped.length };
        return s.cleanAt >= s.written.length ? "done" : "more";
      }
    },
    {
      name: "verify",
      word: "checking the set",
      run: async (s, t) => {
        // The Andromeda gate, in code, before the lenses (copy.js Verify).
        const collided = new Set(ctaCollisions(s.cleaned.filter((p) => p.length !== "subject")));
        if (collided.size) {
          s.dropped.push(...s.cleaned.filter((p) => collided.has(p.pieceId)).map((p) => ({
            ...p, violations: ["andromeda: closing line collides with another reason"],
            reason: "its close was interchangeable with an ad on a different reason"
          })));
          s.cleaned = s.cleaned.filter((p) => !collided.has(p.pieceId));
        }
        s.collided = collided.size;
        s.distinctReasons = new Set(s.cleaned.map((p) => p.angleId)).size;
        if (await t.fit(3, reserveSonnet(36000, 3000)) < 3) throw t.stopAtCap("checking the set");
        const set = setJson(s);
        const lenses = await Promise.all([
          t.ask({ label: "verify-promise", model: SONNET, schema: ISSUES_SCHEMA, maxTokens: 3000, effort: "medium",
            user: `PROMISE VERSUS TERMS. Read the offer, then read every piece of copy. Report any
piece that promises something the offer does not actually deliver, names a term that does not
match, or implies a result the offer never claimed.

THE OFFER:
${s.inputs.offer.slice(0, 8000)}

THE COPY:
${set}` }),
          t.ask({ label: "verify-voice", model: SONNET, schema: ISSUES_SCHEMA, maxTokens: 3000, effort: "medium",
            user: `HUMAN VOICE. These pieces have all passed a mechanical check, so they break no
rules. Your job is different: which of them are technically clean and still read like ads?
Read each one out loud in your head. Name the pieceIds that a real person would not say, and
say what is wrong with each.

THE COPY:
${set}` }),
          t.ask({ label: "verify-sameness", model: SONNET, schema: ISSUES_SCHEMA, maxTokens: 3000, effort: "medium",
            user: `SAMENESS. Fan-out promises variety. You are the only thing that checks it.

Across this whole set: is this twenty ads, or three ads wearing twenty hats? Look for near
duplicate hooks, the same sentence structure repeating, the same opening word, the same
rhythm. Name the pieceIds that collapse into each other.

THE COPY:
${set}` })
        ]);
        s.issues = lenses.flatMap((l) => l.issues || []);
        s.counts = { ...s.counts, issues: s.issues.length };
        return "done";
      }
    },
    {
      name: "assemble",
      word: "writing the copy document",
      run: async (s, t) => {
        if (await t.fit(1, reserveOpus(40000, 12000)) < 1) throw t.stopAtCap("writing the copy document");
        let doc = await t.ask({ label: "assemble", model: OPUS, user: assemblePrompt(s), maxTokens: 12000, effort: "low" });
        if (!doc.includes("## Review card")) doc = `${doc.trim()}\n\n${codeReviewCard(s)}`;
        s.document = doc.replace(/—/g, "-");
        return "done";
      }
    },
    {
      name: "save",
      word: "saving to the repo",
      run: async (s, t) => {
        const hooks = s.cleaned.filter((p) => p.length !== "subject").length;
        const counts = {
          hooks,
          humanizerPassRun: 1,
          droppedForTells: s.dropped.length,
          anglesUsed: s.distinctReasons,
          distinctReasons: s.distinctReasons,
          droppedForCtaCollision: s.collided,
          meetsAndromedaFloor: s.distinctReasons >= ANDROMEDA_FLOOR ? 1 : 0
        };
        const text = stampStage({ stage: STAGE, version: s.inputs.version, inputs: s.inputs.hashes, counts, body: `# ${s.inputs.campaignName} copy: what to run\nAs of ${s.today}\n\n${s.document.replace(/^#[^\n]*\n(As of[^\n]*\n)?/, "")}` });
        const saved = await saveStageFile(ctx, { campaign: s.campaign, file: FILE, text, jobId: ctx.jobId });
        const spent = await t.spentSoFar();
        return {
          done: {
            stage: STAGE, campaign: s.campaign, file: FILE, repo_path: saved.path, outbox_id: saved.outbox_id,
            version: s.inputs.version, counts, angles: s.angles, pieces: s.cleaned, dropped: s.dropped,
            issues: s.issues, below_andromeda_floor: s.distinctReasons < ANDROMEDA_FLOOR,
            fewer_because: s.fewerBecause || null, inputs_source: s.inputs.source,
            cost_usd: Math.round(spent * 10000) / 10000
          }
        };
      }
    }
  ];
}

/** One piece through the humanizer loop (copy.js Humanize, per piece). */
async function cleanOne(piece, s, t) {
  let current = { ...piece };
  let pass = 0;
  let hits = banScan(pieceText(current));
  while (hits.length && pass < MAX_PASSES) {
    pass += 1;
    const full = pieceText(current);
    const attack = await t.ask({ label: `attack-${current.pieceId}-p${pass}`, model: SONNET, user: attackPrompt(full, hits),
      schema: FINDINGS_SCHEMA, maxTokens: 2000, effort: "low" });
    const rewrite = await t.ask({ label: `rewrite-${current.pieceId}-p${pass}`, model: SONNET,
      user: rewritePrompt(full, hits, attack.findings || [], s.inputs.tokens), schema: REWRITE_SCHEMA, maxTokens: 2000, effort: "low" });
    if (!rewrite || !rewrite.hook) break;
    current = { ...current, hook: rewrite.hook, body: rewrite.body || "", cta: rewrite.cta || "" };
    hits = banScan(pieceText(current));
  }
  current.humanizePasses = pass;
  if (hits.length) {
    return { drop: { ...current, violations: hits.map((h) => `${h.kind}: ${h.hit}`), reason: `still had AI tells after ${pass} passes` } };
  }
  if (!keepsSpecifics(pieceText(current), s.inputs.tokens)) {
    return { drop: { ...current, violations: [], reason: "the rewrite sanded off every concrete number" } };
  }
  return { keep: current };
}

/** A review card made from the run's own counts, used only when the writer left it off. */
export function codeReviewCard(s) {
  return [
    "## Review card",
    "",
    `**What this decided:** ${s.cleaned.length} pieces passed the checks across ${s.distinctReasons} reasons to buy; ${s.dropped.length} were dropped.`,
    "",
    "**Three things to check:** Read hook #1 out loud - would you say that? · Does any line promise a credit result or an income number? · Which three hooks do we run?",
    "",
    `**What I wasn't sure about:** ${s.distinctReasons < ANDROMEDA_FLOOR ? `only ${s.distinctReasons} reasons survived, below the floor of ${ANDROMEDA_FLOOR}.` : "nothing"}`,
    "",
    "**Say one of:** approve · tweak: <what to change> · redo",
    ""
  ].join("\n");
}

/**
 * runStage(job, ctx) — the flywheel_stage handler's entry for stage 4.
 * @param {any} job
 * @param {any} ctx
 */
export async function runStage(job, ctx) {
  const c = { ...ctx, orgId: job.org_id, jobId: job.id };
  return runSteps(job, c, { stage: STAGE, steps: steps(c), init: initState });
}
