// U-03 — CRS Snapshot Sync (Soft Pull Complete).
// Source: the CRM system map UNDERWRITEIQ WORKFLOWS section.
// Trigger: analysis.completed, gated on source === "crs" (the CRS adapter always
// tags its analysis.completed events this way — src/adapters/crs.mjs).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";
import { detectAndPauseFunding } from "../crs/snapshot-negatives.mjs";
import { isEmptyRehearsal } from "./simulated-pull.mjs";

export async function handle({ event, db, step }) {
  if (event.payload?.source !== "crs") return { done: false, reason: "not_crs_source" };
  // A rehearsal pull has no file. Writing it would null the client's stored score.
  if (isEmptyRehearsal(event.payload)) return { done: false, reason: "simulated_no_file" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("set-crs-fields", () => mergeCustomFields(db, clientId, {
    crs_status: "Complete",
    crs_snapshot_date: event.payload?.occurredAt || new Date().toISOString(),
    crs_fico_score: event.payload?.scores?.ex ?? null
  }));
  await step.run("tag-crs-snapshot", () => addTags(db, clientId, ["crs:snapshot"]));
  const ax07 = await step.run("detect-new-negatives", () =>
    detectAndPauseFunding(db, {
      orgId: event.orgId,
      clientId,
      crsResultId: event.payload?.crsResultId || event.payload?.crs_result_id || null,
      eventId: event.id
    }));

  return { done: true, ax07 };
}

export const u03CrsSnapshotSync = inngest.createFunction(
  { id: "u-03-crs-snapshot-sync", name: "U-03 — CRS Snapshot Sync" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
