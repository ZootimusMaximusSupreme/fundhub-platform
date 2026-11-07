// The Inngest sync/execute endpoint — /api/inngest.
//
// TWO RUNTIMES. `inngest/node`'s serve() expects a real Node stream and a real
// ServerResponse. Netlify — the only deployed target — routes everything through
// netlify/functions/api.mjs, which hands handlers a plain object with the body
// already read. Calling the Node serve() there throws inside Inngest's own
// body reader, so /api/inngest answered 500 on POST and PUT: Inngest could
// neither register the app nor invoke a single function. Combined with the route
// not being in the ROUTES table at all (a 404 before that), all 47 workflow
// functions were unreachable on the deployed site — setting INNGEST_EVENT_KEY
// would have woken nothing.
//
// `inngest/edge`'s serve() takes a Web Request and returns a Web Response, which
// is exactly the Netlify function signature, so the Netlify path uses it
// directly and never goes through the (req, res) shim.
//
// The Node export is kept for the Vercel-style target and for local Node
// servers, so this file works on both without either one being second-class.

import { serve as serveNode } from "inngest/node";
import { serve as serveEdge } from "inngest/edge";
import { Readable } from "node:stream";
import { inngest } from "../src/workflows/client.mjs";
/* Event workflows only. Every cron runs on the Netlify clock (netlify/functions/cron-clock.mjs) since
   2026-10-20, because the Inngest free plan cannot carry them. Never pass `functions` here: that is the
   whole registry, scheduled jobs included, and serving it would put every cron back on Inngest. */
import { inngestFunctions as functions } from "../src/workflows/index.mjs";

/* The Web-standard handler: (Request) => Promise<Response>. Netlify's adapter
   calls this directly — see the `inngest` entry in netlify/functions/api.mjs. */
// Compensating ingress control for GHSA-mrhx-c7xc-m3w5, not an SDK fix.
// Official serve guidance allows 4 MB; platform limits allow 5,000 sent events
// and 1,000 steps. Do not cap arrays inside legitimate event/step data.
// https://www.inngest.com/docs/learn/serving-inngest-functions
// https://www.inngest.com/docs/durable-execution/limits
export const INNGEST_MAX_BYTES = 4 * 1024 * 1024;
export const INNGEST_MAX_EVENTS = 5000;
export const INNGEST_MAX_STEPS = 1000;

function refusal(status, code) { return Object.assign(new Error(code), { status, code }); }
function productionGuard(env) {
  const production = env.CONTEXT === "production" || env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" || env.NETLIFY === "true";
  const dev = env.INNGEST_DEV;
  if (production && (!env.INNGEST_SIGNING_KEY ||
      (dev !== undefined && !["0", "false"].includes(String(dev).toLowerCase())))) {
    throw refusal(503, "inngest_security_not_configured");
  }
}
function checkLength(length) {
  if (/^\d+$/.test(String(length)) && Number(length) > INNGEST_MAX_BYTES) {
    throw refusal(413, "inngest_request_too_large");
  }
}
function checkEnvelope(bytes, method) {
  if (!bytes.length) return; // Ship's empty out-of-band PUT must reach the SDK.
  let body;
  try { body = JSON.parse(bytes.toString("utf8")); }
  catch { throw refusal(400, "invalid_inngest_envelope"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw refusal(400, "invalid_inngest_envelope");
  if (method !== "POST") return; // PUT sync has its own SDK schema.
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const events = body.events;
  if (events !== undefined && (!Array.isArray(events) || events.length > INNGEST_MAX_EVENTS || !events.every(object))) {
    throw refusal(400, "invalid_inngest_envelope");
  }
  if (body.steps != null && (!object(body.steps) || Object.keys(body.steps).length > INNGEST_MAX_STEPS)) {
    throw refusal(400, "invalid_inngest_envelope");
  }
  const stack = body.ctx?.stack?.stack;
  if (stack != null && (!Array.isArray(stack) || stack.length > INNGEST_MAX_STEPS || !stack.every(value => typeof value === "string"))) {
    throw refusal(400, "invalid_inngest_envelope");
  }
}
async function webBytes(request) {
  checkLength(request.headers.get("content-length"));
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > INNGEST_MAX_BYTES) {
        // Do not await a remote stream's cancellation acknowledgement.
        void reader.cancel().catch(() => {});
        throw refusal(413, "inngest_request_too_large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } finally { reader.releaseLock(); }
}
function nodeBytes(req) {
  checkLength(req.headers?.["content-length"]);
  // The Node adapter requires an unread live stream. Do not wait forever for
  // events a consumed or disconnected host request has already emitted.
  if (req.readableEnded || req.destroyed || req.aborted) throw refusal(400, "invalid_inngest_envelope");
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0;
    const cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted); };
    const error = err => {
      cleanup(); req.pause();
      // IncomingMessage can emit ECONNRESET after its aborted event. Keep that
      // expected follow-up from becoming an unhandled process-level error.
      const ignore = () => {};
      req.on("error", ignore); req.once("close", () => req.off("error", ignore));
      reject(err);
    };
    const aborted = () => error(refusal(400, "invalid_inngest_envelope"));
    const data = chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > INNGEST_MAX_BYTES) return error(refusal(413, "inngest_request_too_large"));
      chunks.push(bytes);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, length)); };
    req.on("data", data); req.once("end", end); req.once("error", error); req.once("aborted", aborted);
  });
}
export function createInngestBoundary({ web, node, env = process.env }) {
  return {
    async web(request) {
      try {
        productionGuard(env);
        if (!["POST", "PUT"].includes(request.method)) return web(request);
        const bytes = await webBytes(request);
        checkEnvelope(bytes, request.method);
        // Netlify v2 gives a Web Request, not Lambda's base64 event wrapper.
        // Forward exact bytes; never stringify the parsed guard copy or decode
        // base64 strings inside event/step data. SDK signature checks stay intact.
        return web(new Request(request, { body: bytes, duplex: "half" }));
      } catch (error) {
        return Response.json({ error: error.code || "invalid_inngest_envelope" }, {
          status: error.status || 400, headers: { "cache-control": "no-store" } });
      }
    },
    async node(req, res) {
      try {
        productionGuard(env);
        if (!["POST", "PUT"].includes(req.method)) return node(req, res);
        const bytes = await nodeBytes(req);
        checkEnvelope(bytes, req.method);
        const replay = Readable.from([bytes], { objectMode: false });
        Object.assign(replay, { headers: req.headers, method: req.method, url: req.url, socket: req.socket });
        return node(replay, res);
      } catch (error) {
        res.writeHead(error.status || 400, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
        res.end(JSON.stringify({ error: error.code || "invalid_inngest_envelope" }), () => req.destroy());
      }
    }
  };
}
const guarded = createInngestBoundary({ web: serveEdge({ client: inngest, functions }),
  node: serveNode({ client: inngest, functions }) });
export const webHandler = guarded.web;

/* The Node handler: (req, res). Used by the Vercel-style target. */
const nodeHandler = guarded.node;

export default nodeHandler;
