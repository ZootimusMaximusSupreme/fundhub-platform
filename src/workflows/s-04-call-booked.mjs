// S-04 — Call Booked -> Move to S2.
// Source: the CRM system map SALES WORKFLOWS section.
// Trigger: booking.created (exact canonical match). Tags call:booked, sets
// cf_call_outcome=booked, moves the sales card to the "booked" stage
// (db/seed/002_pipelines.sql: sales.booked).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";
import { advanceCardToStage } from "./cards.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  await step.run("tag-call-booked", () => addTags(db, clientId, ["call:booked"]));
  await step.run("set-call-outcome", () => mergeCustomFields(db, clientId, { call_outcome: "booked" }));
  const card = await step.run("move-to-booked-stage", () =>
    advanceCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "booked" }));

  return { done: true, card };
}

export const s04CallBooked = inngest.createFunction(
  { id: "s-04-call-booked", name: "S-04 — Call Booked" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
