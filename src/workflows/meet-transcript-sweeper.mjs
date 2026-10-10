// Sales recordings path: pick new Meet files from Drive, then pull words.
// Pair a sibling Transcript / Gemini-notes doc first. Whisper one short leftover
// per org per pass. Long files wait for the Google transcript doc.
// Company Brain embed is not required — words still land on call_outcomes.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sweepMeetTranscripts } from "../company-brain/meet-transcript.mjs";

export const SWEEP_CRON = "*/10 * * * *";

export async function handle({ db: database = db, step, env = process.env } = {}) {
  const run = step?.run
    ? (name, fn) => step.run(name, fn)
    : (_n, fn) => fn();
  return run("sweep-meet-words", () => sweepMeetTranscripts(database, { env }));
}

export const meetTranscriptSweeper = inngest.createFunction(
  { id: "meet-transcript-sweeper", name: "Meet transcript sweeper (Drive words + short Whisper)" },
  { cron: SWEEP_CRON },
  async ({ step }) => handle({ db, step })
);
