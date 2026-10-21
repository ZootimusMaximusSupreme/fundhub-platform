import { handleWebhook } from "../../http/router.mjs";
import merchantEvents from "../../../api/merchant/events.mjs";
import rb2bWebhook from "../../../api/public/rb2b-webhook.mjs";
import vslWatch from "../../../api/public/vsl-watch.mjs";
import contractSign from "../../../api/contracts/sign.mjs";
import adVideoApprove from "../../../api/public/ad-video-approve.mjs";
import documentDownload from "../../../api/documents/[id].mjs";
import adVideoWorker from "../../../netlify/functions/ad-video-worker-background.mjs";
import { gapChecks as adVideoJobChecks } from "./gap-door-batch-jobs.mjs";
import { parkRow } from "../parked-features.mjs";

const FILE_RE = /\b(?:(?:src|api|netlify|scripts|e2e)\/)?[A-Za-z0-9_./[\]-]+\.test\.mjs\b/g;
const RESULT_RE = /\bsrc\/pulse\/(?:coverage\/gap-|beats\/beat-)[A-Za-z0-9_./-]+\.mjs\b/g;

export const WEBHOOK_RESULT_EVIDENCE =
  "src/pulse/coverage/gap-door-batch-webhooks.mjs " +
  "src/pulse/catalog/proofs/door-batch-webhook-result.test.mjs";

export const CHECK_IDS = Object.freeze([
  "door-batch:webhook-lendflow-contract",
  "door-batch:webhook-ad-video-worker",
]);
export const KNOWN_GAP_TEST =
  "src/pulse/catalog/proofs/door-batch-webhook-red.test.mjs";

const KNOWN_GAP_SURFACES = new Set([
  "webhook:POST /api/webhooks/lendflow",
  "webhook:POST netlify/functions/ad-video-worker-background",
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function companion(reference) {
  return reference.replace(/\.mjs$/, ".test.mjs");
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; },
  };
}

function readOnlyDb() {
  return {
    async query(sql) {
      if (!/^\s*(?:SELECT|WITH)\b/i.test(String(sql))) throw new Error("webhook proof reached a write");
      return { rows: [] };
    },
  };
}

async function callHandler(handler, request, deps) {
  const response = responseRecorder();
  const returned = await handler(request, response, deps);
  if (returned instanceof Response) {
    return { status: returned.status, body: await returned.text() };
  }
  return { status: response.statusCode, body: response.body };
}

function providerFrom(surface) {
  const match = /^webhook:POST \/api\/webhooks\/([^/]+)/.exec(surface);
  if (!match) return null;
  if (match[1] === "merchant-whop") return "merchant-whop/00000000-0000-4000-8000-000000000001";
  if (match[1] === "merchant-commas") return "merchant-commas/00000000-0000-4000-8000-000000000001";
  return match[1];
}

export function webhookProofReferences(row) {
  const evidence = String(row?.evidence || "");
  const tests = unique(evidence.match(FILE_RE) || []).filter((file) => !file.endsWith(".pg.test.mjs"));
  const results = unique(evidence.match(RESULT_RE) || []);
  return { tests, results };
}

export async function evaluateWebhookGate(row) {
  const surface = String(row?.surface || "");
  const db = readOnlyDb();
  let out;
  const provider = providerFrom(surface);
  if (provider) {
    out = await handleWebhook({
      db,
      provider,
      rawBody: "{}",
      headers: {},
      url: `https://fundhub.example.test/api/webhooks/${provider}`,
      env: {
        BLAND_WEBHOOK_SECRET: "fake-bland-secret",
        LENDFLOW_WEBHOOK_SECRET: "fake-lendflow-secret",
        MAILGUN_SIGNING_KEY: "fake-mailgun-secret",
        POSTGRID_WEBHOOK_SECRET: "fake-postgrid-secret",
        MERCHANT_SECRET_ENC_KEY: "fake-merchant-encryption-secret",
      },
    });
  } else if (surface === "webhook:POST /api/merchant/events") {
    out = await callHandler(merchantEvents, { method: "POST", headers: {}, body: {} }, { db });
  } else if (surface === "webhook:GET|POST /api/public/rb2b-webhook") {
    out = await callHandler(rb2bWebhook, {
      method: "POST", query: { secret: "wrong" }, headers: {}, body: {},
    }, { db, secret: "fake-rb2b-secret" });
  } else if (surface === "webhook:POST /api/public/vsl-watch") {
    out = await callHandler(vslWatch, { method: "TRACE", query: {}, headers: {}, body: {} }, { db });
  } else if (surface === "webhook:GET|POST /api/contracts/sign") {
    out = await callHandler(contractSign, { method: "GET", query: { id: "bad" }, headers: {} });
  } else if (surface === "webhook:GET|POST /api/public/ad-video-approve") {
    out = await callHandler(adVideoApprove, { method: "GET", query: {}, headers: {} });
  } else if (surface === "webhook:GET /api/documents/[id]") {
    out = await callHandler(documentDownload, { method: "GET", query: { id: "bad" }, headers: {} });
  } else if (surface === "webhook:POST netlify/functions/ad-video-worker-background") {
    out = await callHandler(adVideoWorker, { headers: new Headers({ "x-fundhub-worker": "wrong" }) });
  } else {
    return { ok: false, problems: ["no safe webhook probe"] };
  }

  const problems = [];
  if (!Number.isInteger(out?.status) || out.status < 400 || out.status >= 500) {
    problems.push(`unsafe refusal status ${out?.status}`);
  }
  return { ok: problems.length === 0, problems, status: out?.status };
}

export function webhookResultProof(row) {
  if (KNOWN_GAP_SURFACES.has(row?.surface)) {
    return {
      depth: ["money", "customerMessage", "customerData"].includes(row?.impact) ? "deep" : "e2e",
      evidence: unique([WEBHOOK_RESULT_EVIDENCE, KNOWN_GAP_TEST]).join(" "),
      asserts: row.control,
    };
  }
  if (/unverified/i.test(String(row?.signature || ""))) return null;
  const refs = webhookProofReferences(row);
  const sensitive = ["money", "customerMessage", "customerData"].includes(row?.impact);
  if (sensitive && refs.tests.length === 0 && refs.results.length === 0) return null;
  return {
    depth: sensitive ? "deep" : "e2e",
    evidence: unique([
      WEBHOOK_RESULT_EVIDENCE,
      ...refs.tests,
      ...refs.results,
      ...refs.results.map(companion),
    ]).join(" "),
    asserts: row.control,
  };
}

export async function gapChecks(ctx = {}) {
  const jobCtx = typeof ctx?.scope?.run === "function" ? { ...ctx, run: ctx.scope.run } : ctx;
  const worker = (await adVideoJobChecks(jobCtx))[0];
  const lendflow = {
    id: CHECK_IDS[0],
    status: "FAIL",
    detail: "The Lendflow door and fail-closed HMAC code run, but no real Lendflow payload has confirmed the provider's signature scheme or stage words.",
    suggestedFix: "Keep this red until one real or sandbox Lendflow payload confirms the header, HMAC scheme, and stage words.",
  };
  // Owner answer B8 (2026-10-20): Lendflow is paused by the owner. The red above stands
  // the day a Lendflow key is set or a Lendflow webhook arrives (src/pulse/parked-features.mjs).
  const lendflowRow = await parkRow(lendflow, "lendflow", {
    scope: typeof ctx?.scope === "function" ? ctx.scope : null,
    env: ctx?.env,
    now: ctx?.now,
  });
  return [
    lendflowRow,
    {
      id: CHECK_IDS[1],
      status: worker.status,
      detail: "The ad-video worker secret guard is closed. " + worker.detail,
      suggestedFix: worker.suggestedFix,
    },
  ];
}
