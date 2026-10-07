// Inngest client — Master Rebuild Spec §2/§6: the 140 CRM workflows become Inngest
// functions (durable steps, waits, branches), ~60 of which actually survive.
// One client for the whole platform; each workflow file in this directory registers
// exactly one function against it.
import { Inngest, InngestMiddleware } from "inngest";
import { db } from "../db.mjs";
import { heartbeatHooks } from "../pulse/heartbeats.mjs";

const heartbeat = new InngestMiddleware({
  name: "Job heartbeat",
  init: () => heartbeatHooks({ getDb: () => db })
});

export const inngest = new Inngest({ id: "fundhub-platform", middleware: [heartbeat] });
