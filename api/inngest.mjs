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
import { inngest } from "../src/workflows/client.mjs";
/* Event workflows only. Every cron runs on the Netlify clock (netlify/functions/cron-clock.mjs) since
   2026-10-20, because the Inngest free plan cannot carry them. Never pass `functions` here: that is the
   whole registry, scheduled jobs included, and serving it would put every cron back on Inngest. */
import { inngestFunctions as functions } from "../src/workflows/index.mjs";

/* The Web-standard handler: (Request) => Promise<Response>. Netlify's adapter
   calls this directly — see the `inngest` entry in netlify/functions/api.mjs. */
export const webHandler = serveEdge({ client: inngest, functions });

/* The Node handler: (req, res). Used by the Vercel-style target. */
const nodeHandler = serveNode({ client: inngest, functions });

export default nodeHandler;
