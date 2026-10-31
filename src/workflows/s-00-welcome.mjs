// S-00 — Welcome. Spec 4.1 (2026-08-22).
// Trigger: entry.captured. Immediate EMAIL-S00-WELCOME + SMS-S00-WELCOME.
// at-01, s-01, af-02 keep running alongside, and s-02 follows up if the survey stalls.
// Both messages carry {{survey_resume_link}} (owner-set 2026-10-31): the signed link
// that opens /apply on the question the person is up to (src/survey/resume-link.mjs).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { claimCustomFieldLock } from "./custom-fields.mjs";
import { surveyResumeUrl } from "../survey/resume-link.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-S00-WELCOME";
export const SMS_TEMPLATE_KEY = "SMS-S00-WELCOME";
export const LOCK_FIELD = "s00_welcome_sent_at";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const claimed = await step.run("claim-welcome", () =>
    claimCustomFieldLock(db, clientId, LOCK_FIELD));
  if (!claimed) return { done: false, reason: "already_locked" };

  const orgId = event.orgId;
  const eventId = event.id;
  const context = () => ({ survey_resume_link: surveyResumeUrl({ orgId, clientId }) });
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId, context: context() }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId, context: context() }));

  return { done: true, email, sms };
}

export const s00Welcome = inngest.createFunction(
  { id: "s-00-welcome", name: "S-00 — Welcome" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
