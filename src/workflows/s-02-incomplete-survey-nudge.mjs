// S-02 — Incomplete App (Survey).
// Source: the CRM system map SALES WORKFLOWS section.
// Audit fix applied (workflow-coherence-audit.md: "S-02 — 2-min wait before
// survey-complete check; too short. Bump to 15-30 min") — 20 min picked (midpoint
// of the given range, a timing choice not a business one).
//
// (A second, unrelated "S-02 — Attribution Capture" also exists in the map with the
// same key; that one is a duplicate of AT-01's First Touch Date logic and isn't
// ported separately — see workflow-migration-table.md.)
//
// Trigger: entry.captured -> step.sleep(20m) -> check whether survey.submitted has
// since fired. If yes, tag survey:complete and stop (no nudge). If not, send the
// "finish your application" nudge.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { messageCohortId, sendTemplated } from "./messaging.mjs";
import { addTags } from "./tags.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-S02-FINISH-APPLICATION";

// Match on client_id OR on the email inside the event payload. Capture sources
// that predate T14-11 wrote survey.submitted with client_id NULL, which made the
// client_id-only check unsatisfiable — so this job nudged people who had in fact
// finished the survey. The email arm covers those rows.
export async function surveyCompleted(db, clientId, email) {
  const addr = String(email || "").trim().toLowerCase();
  // Param order stays [clientId, names, ...] so the shared pg fake keeps matching.
  const r = await db.query(
    `SELECT DISTINCT name FROM events
      WHERE name = ANY($2)
        AND (client_id = $1 OR ($3 <> '' AND lower(payload->>'email') = $3))`,
    [clientId, ["survey.submitted"], addr]
  );
  return r.rows.some((row) => row.name === "survey.submitted");
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.sleep("wait-20-min", "20m");

  const leadEmail = (event.payload || {}).email || null;
  const completed = await step.run("check-survey-complete", () => surveyCompleted(db, clientId, leadEmail));
  if (completed) {
    await step.run("tag-survey-complete", () => addTags(db, clientId, ["survey:complete"]));
    return { done: true, nudged: false };
  }

  const email = await step.run("send-nudge-email", async () => {
    const cohortId = await messageCohortId(db, { eventId: event.id, orgId: event.orgId, clientId, name: "entry.captured" });
    return sendTemplated(db, { orgId: event.orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId: cohortId });
  });

  return { done: true, nudged: true, email };
}

export const s02IncompleteSurveyNudge = inngest.createFunction(
  { id: "s-02-incomplete-survey-nudge", name: "S-02 — Incomplete App (Survey)" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
