// U-04 — Promote CRS as Primary Snapshot.
// Source: the CRM system map UNDERWRITEIQ WORKFLOWS section.
// Trigger: analysis.completed, gated on source === "crs" (same gate as U-03 — the
// Primary Snapshot rule is "CRS always wins over the Analyzer estimate once it
// lands").

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { removeTags } from "./tags.mjs";
import { isEmptyRehearsal } from "./simulated-pull.mjs";

export async function handle({ event, db, step }) {
  if (event.payload?.source !== "crs") return { done: false, reason: "not_crs_source" };
  // A rehearsal pull has no file. Promoting it would null the client's stored score.
  if (isEmptyRehearsal(event.payload)) return { done: false, reason: "simulated_no_file" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("promote-crs", () => mergeCustomFields(db, clientId, {
    primary_snapshot_source: "CRS",
    primary_fico_score: event.payload?.scores?.ex ?? null
  }));
  await step.run("remove-primary-analyzer-tag", () => removeTags(db, clientId, ["primary:analyzer"]));

  return { done: true };
}

export const u04PromoteCrsPrimary = inngest.createFunction(
  { id: "u-04-promote-crs-primary", name: "U-04 — Promote CRS as Primary Snapshot" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
