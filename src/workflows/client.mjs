// Inngest client — Master Rebuild Spec §2/§6: the 140 CRM workflows become Inngest
// functions (durable steps, waits, branches), ~60 of which actually survive.
// One client for the whole platform; each workflow file in this directory registers
// exactly one function against it.
import { Inngest, InngestMiddleware } from "inngest";
import { db } from "../db.mjs";
import { heartbeatHooks } from "../pulse/heartbeats.mjs";
import { RUN_EVIDENCE_NAME, runEvidenceHooks } from "../pulse/run-evidence.mjs";

const heartbeat = new InngestMiddleware({
  name: "Job heartbeat",
  init: () => heartbeatHooks({ getDb: () => db })
});

/* Run evidence (2026-10-09): a receipt for every run an EVENT started — a start mark and a finish mark in
   workflow_runs, so the morning pulse can say a real green or a real red for it. Crons stay with the heartbeat
   above. It never changes a workflow's output and never throws into it (src/pulse/run-evidence.mjs).
   To switch it off with no deploy: REVOKE INSERT, UPDATE ON workflow_runs FROM fundhub_app. */
const runEvidence = new InngestMiddleware({
  name: RUN_EVIDENCE_NAME,
  init: () => runEvidenceHooks({ getDb: () => db })
});

export const inngest = new Inngest({ id: "fundhub-platform", middleware: [heartbeat, runEvidence] });
