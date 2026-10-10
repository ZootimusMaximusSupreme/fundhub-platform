// Company Brain search gaps for the morning pulse. Read only. Report only.
//
// DRIVE SYNC IS NOT HERE ON PURPOSE. src/pulse/machine.mjs checkMeetTranscripts
// (id: meet-transcript-sweeper) already reads brain_drive_sync every morning:
// last_error set, and no scan in 30 minutes (3 times the 10 minute sweeper).
// The door pings reg:read/company-brain and reg:read/company-brain-affiliate
// already ask whether those two doors answer. Copying either one here would
// add another watcher for the same fault. Recon (AG-07) is the one tripwire.
//
// WHAT NONE OF THOSE CAN SEE. Both search doors are POST only. A GET answers
// 405 whether search works or not, so a ping stays green while every search
// crashes. This file runs the REAL door code in this process, with the same
// database, and reads the real result:
//   * the door's own code runs (auth gate and the model call are swapped out)
//   * the search SQL runs against brain_chunks, read only, limit 1
//   * the query vector is a fixed stub, so no AI call is made and nothing is
//     spent
//   * the chat history writes are switched off, so nothing is saved
// A 500, a throw, or an error body is a fail.
//
// THE ONE THING THE STUB HIDES. The question vector above is fixed, so the real
// door could still answer 502 in production because it cannot embed the
// question (no OpenAI key, or a key that is only a row of asterisks). The third
// row, brain:embed-key, looks at the key the runtime holds and says so. It
// sends nothing to OpenAI and spends nothing.
//
// Never runs a Drive sync. Never uploads. Never POSTs over the network.

import { EMBEDDING_DIMS, embedConfigFromEnv } from "../../company-brain/embed.mjs";
import { retrieveChunks, retrieveAffiliateChunks } from "../../company-brain/retrieve.mjs";

export const ID_STAFF = "brain:search-staff";
export const ID_AFFILIATE = "brain:search-affiliate";
export const ID_EMBED = "brain:embed-key";

export const CHECK_IDS = Object.freeze([ID_STAFF, ID_AFFILIATE, ID_EMBED]);

/** The question the door is asked. It is never sent to a model. */
export const PROBE_QUESTION = "morning pulse read check";

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not add another watcher. " +
  "Do not run a new Drive sync. Do not upload.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(text, n = 160) {
  const s = String((text && text.message) || text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/** A fixed unit vector the size of the real embeddings. No model is asked. */
function stubEmbed() {
  const vec = new Array(EMBEDDING_DIMS).fill(0);
  vec[0] = 1;
  return async () => ({ ok: true, embeddings: [vec] });
}

/** Never reaches a model. The door still builds and returns its own answer shape. */
async function stubAnswer() {
  return { text: "", citations: [], thin: true, source: "pulse-read-check" };
}

// History is best effort in the door. These return "not saved", so no row is written.
const noHistory = {
  getThread: async () => ({ ok: false }),
  createThread: async () => ({ ok: false }),
  appendMessage: async () => ({ ok: false })
};

// Literal import paths on purpose: the function bundle can only ship a file it can see.
async function loadStaffDoor() {
  return (await import("../../../api/read/company-brain.mjs")).default;
}
async function loadAffiliateDoor() {
  return (await import("../../../api/read/company-brain-affiliate.mjs")).default;
}

function staffDeps(db, orgId) {
  const embed = stubEmbed();
  return {
    db,
    env: {},
    requireAuth: async () => ({
      id: null,
      org_id: orgId,
      role: "owner",
      name: "Morning pulse",
      email: "pulse@fundhub.ai"
    }),
    retrieveChunks: (database, args) => retrieveChunks(database, { ...args, embed }),
    synthesizeAnswer: stubAnswer,
    ...noHistory
  };
}

function affiliateDeps(db, orgId) {
  const embed = stubEmbed();
  return {
    db,
    env: {},
    requirePrincipal: async () => ({ kind: "affiliate", role: "affiliate", org_id: orgId }),
    retrieveAffiliateChunks: (database, args) => retrieveAffiliateChunks(database, { ...args, embed }),
    synthesizeAnswer: stubAnswer
  };
}

async function openDoor(handler, deps) {
  const res = mockRes();
  const req = {
    method: "POST",
    headers: {},
    query: {},
    body: { question: PROBE_QUESTION, limit: 1 }
  };
  try {
    await handler(req, res, deps);
    return { status: res.statusCode, body: res.body, thrown: null };
  } catch (err) {
    return { status: res.statusCode, body: res.body, thrown: err };
  }
}

function score(id, label, path, outcome) {
  if (outcome.thrown) {
    return row(
      id,
      "FAIL",
      `${label} search crashed: ${clip(outcome.thrown)}`,
      `${RECON} Read POST ${path} and the brain_chunks search. The check calls it with no AI and saves nothing.`
    );
  }
  const status = Number(outcome.status) || 0;
  const body = outcome.body;
  const errorText = body && (body.error || body.message) ? clip(body.error || body.message, 80) : "";
  if (status === 200 && body && body.ok === true) {
    return row(id, "PASS", `${label} search ran on the real database and answered 200 (no AI call, nothing saved)`);
  }
  const why = errorText ? ` (${errorText})` : "";
  return row(
    id,
    "FAIL",
    status ? `${label} search answered ${status}${why}` : `${label} search gave no answer${why}`,
    `${RECON} Read POST ${path} and the brain_chunks search. The check calls it with no AI and saves nothing.`
  );
}

/** Four or more asterisks in a row is a display mask (Netlify list, a pasted copy), never a key. */
const MASKED = /\*{4,}/;

/**
 * Can the runtime turn a question into a search vector? Looks at the same key
 * the real embed step reads (OPENAI_API_KEY, else COMPANY_BRAIN_OPENAI_API_KEY).
 * No network call, no spend, and the key itself is never printed.
 */
function checkEmbedKey(ctx) {
  const env = ctx.env;
  if (!env || typeof env !== "object") {
    return row(ID_EMBED, "skip", "no env in this run — the Company Brain search key was not looked at");
  }
  const cfg = embedConfigFromEnv(env);
  const key = cfg.apiKey == null ? "" : String(cfg.apiKey).trim();
  const name = env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "COMPANY_BRAIN_OPENAI_API_KEY";
  if (!cfg.ready || !key) {
    return row(
      ID_EMBED,
      "FAIL",
      "No OpenAI key is set for Company Brain. Every question gets a 502 and no new text file can be saved for search.",
      `Set a real OpenAI key in OPENAI_API_KEY (or COMPANY_BRAIN_OPENAI_API_KEY) and ship once. ${RECON}`
    );
  }
  if (MASKED.test(key)) {
    return row(
      ID_EMBED,
      "FAIL",
      `${name} is a row of asterisks (a mask), not a key. OpenAI refuses it, so Company Brain cannot turn a question into a search. Every question gets a 502 and no new text file can be saved for search.`,
      `Put the real OpenAI key in ${name} and ship once. Do not unset or delete any stored key. ${RECON}`
    );
  }
  return row(ID_EMBED, "PASS", `${name} is set and is not a mask (nothing was sent to OpenAI)`);
}

async function checkStaff(ctx, db, orgId) {
  try {
    const handler = ctx.brainDoors && ctx.brainDoors.staff
      ? ctx.brainDoors.staff
      : await loadStaffDoor();
    const outcome = await openDoor(handler, staffDeps(db, orgId));
    return score(ID_STAFF, "Company Brain staff", "/api/read/company-brain", outcome);
  } catch (err) {
    return score(ID_STAFF, "Company Brain staff", "/api/read/company-brain", { thrown: err });
  }
}

async function checkAffiliate(ctx, db, orgId) {
  try {
    const handler = ctx.brainDoors && ctx.brainDoors.affiliate
      ? ctx.brainDoors.affiliate
      : await loadAffiliateDoor();
    const outcome = await openDoor(handler, affiliateDeps(db, orgId));
    return score(ID_AFFILIATE, "Company Brain affiliate", "/api/read/company-brain-affiliate", outcome);
  } catch (err) {
    return score(ID_AFFILIATE, "Company Brain affiliate", "/api/read/company-brain-affiliate", { thrown: err });
  }
}

/** Exposed for the tests only: the parts the check swaps into the real doors. */
export const __test = { staffDeps, affiliateDeps };

/**
 * Three read-only checks. ctx: { db, orgId, env }. `ctx.brainDoors` is for tests only.
 * The two search rows need db and orgId; the key row needs only env.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const key = checkEmbedKey(ctx);
  if (!db || typeof db.query !== "function" || !orgId) {
    return [
      row(ID_STAFF, "skip", "no database in this run — Company Brain search not run"),
      row(ID_AFFILIATE, "skip", "no database in this run — Company Brain search not run"),
      key
    ];
  }
  return [
    await checkStaff(ctx, db, orgId),
    await checkAffiliate(ctx, db, orgId),
    key
  ];
}
